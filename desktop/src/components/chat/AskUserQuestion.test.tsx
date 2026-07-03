import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
}))

vi.mock('../../api/websocket', () => ({
  wsManager: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    clearHandlers: vi.fn(),
    send: sendMock,
  },
}))

vi.mock('../../api/sessions', () => ({
  sessionsApi: {
    getMessages: vi.fn(async () => ({ messages: [] })),
    getSlashCommands: vi.fn(async () => ({ commands: [] })),
  },
}))

import { AskUserQuestion } from './AskUserQuestion'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'

const ACTIVE_TAB = 'active-tab'

describe('AskUserQuestion', () => {
  beforeEach(() => {
    sendMock.mockReset()
    useSettingsStore.setState({ locale: 'en' })
    useTabStore.setState({
      activeTabId: ACTIVE_TAB,
      tabs: [{ sessionId: ACTIVE_TAB, title: 'Test', type: 'session', status: 'idle' }],
    })
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: {
          messages: [],
          chatState: 'permission_pending',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: {
            requestId: 'perm-1',
            toolName: 'AskUserQuestion',
            toolUseId: 'tool-1',
            input: {
              questions: [
                {
                  question: 'Should we persist data?',
                  options: [{ label: 'No' }, { label: 'Yes' }],
                },
              ],
            },
          },
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })
  })

  it('submits answers through permission_response updatedInput instead of sending a chat message', () => {
    render(
      <AskUserQuestion
        toolUseId="tool-1"
        input={{
          questions: [
            {
              question: 'Should we persist data?',
              options: [{ label: 'No' }, { label: 'Yes' }],
            },
          ],
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^No$/ }))
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))

    expect(sendMock).toHaveBeenCalledWith(ACTIVE_TAB, {
      type: 'permission_response',
      requestId: 'perm-1',
      allowed: true,
      updatedInput: {
        questions: [
          {
            question: 'Should we persist data?',
            options: [{ label: 'No' }, { label: 'Yes' }],
          },
        ],
        answers: {
          'Should we persist data?': 'No',
        },
      },
    })
  })

  it('keeps custom answers independent per tab', () => {
    const questions = [
      { question: 'Q1?', header: 'Q1', options: [{ label: 'A1' }, { label: 'B1' }] },
      { question: 'Q2?', header: 'Q2', options: [{ label: 'A2' }, { label: 'B2' }] },
    ]
    useChatStore.setState((state) => ({
      sessions: {
        ...state.sessions,
        [ACTIVE_TAB]: {
          ...state.sessions[ACTIVE_TAB]!,
          pendingPermission: {
            requestId: 'perm-1',
            toolName: 'AskUserQuestion',
            toolUseId: 'tool-1',
            input: { questions },
          },
        },
      },
    }))

    render(<AskUserQuestion toolUseId="tool-1" input={{ questions }} />)

    // Type a custom answer on the first tab
    fireEvent.change(screen.getByPlaceholderText(/type/i), {
      target: { value: 'custom for Q1' },
    })

    // Switch to the second tab — its custom field must be empty, not carry Q1's text
    fireEvent.click(screen.getByRole('button', { name: /Q2/ }))
    expect((screen.getByPlaceholderText(/type/i) as HTMLTextAreaElement).value).toBe('')

    // Answer the second tab differently
    fireEvent.change(screen.getByPlaceholderText(/type/i), {
      target: { value: 'custom for Q2' },
    })
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))

    expect(sendMock).toHaveBeenCalledWith(ACTIVE_TAB, {
      type: 'permission_response',
      requestId: 'perm-1',
      allowed: true,
      updatedInput: {
        questions,
        answers: {
          'Q1?': 'custom for Q1',
          'Q2?': 'custom for Q2',
        },
      },
    })
  })

  it('supports multiSelect with checkbox indicators and ;-joined answers', () => {
    const questions = [
      {
        question: 'Pick tools?',
        options: [{ label: 'Bash' }, { label: 'Read' }, { label: 'Write' }],
        multiSelect: true,
      },
    ]
    useChatStore.setState((state) => ({
      sessions: {
        ...state.sessions,
        [ACTIVE_TAB]: {
          ...state.sessions[ACTIVE_TAB]!,
          pendingPermission: {
            requestId: 'perm-1',
            toolName: 'AskUserQuestion',
            toolUseId: 'tool-1',
            input: { questions },
          },
        },
      },
    }))

    render(<AskUserQuestion toolUseId="tool-1" input={{ questions }} />)

    // Multi-select: indicator should be square (checkbox), not round (radio)
    const indicators = screen.getAllByRole('button', { name: /Bash|Read|Write/ })
    expect(indicators).toHaveLength(3)
    // The check indicator div should have rounded-[4px], not rounded-full
    expect(indicators[0]!.innerHTML).toContain('rounded-[4px]')

    fireEvent.click(screen.getByRole('button', { name: /^Bash$/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Write$/ }))
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))

    expect(sendMock).toHaveBeenCalledWith(ACTIVE_TAB, {
      type: 'permission_response',
      requestId: 'perm-1',
      allowed: true,
      updatedInput: {
        questions,
        answers: {
          'Pick tools?': 'Bash; Write',
        },
      },
    })
  })
})
