import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

export const OPEN_PREVIEW_TOOL_NAME = 'OpenPreview'

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z
      .string()
      .describe(
        'The dev server URL to open in the workspace preview pane, e.g. http://127.0.0.1:5173/',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    url: z.string().describe('The URL that was opened'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

const DESCRIPTION =
  'Open a URL in the AmbiCrew workspace preview pane. Use in the preview-edit workflow right after starting the dev server, so the live preview opens automatically without the user pasting the URL.'

const PROMPT = `Open a URL in the AmbiCrew workspace preview pane.

When to use: in the preview-edit workflow, right after you start the dev server (e.g. \`npm run dev\`) and read its URL from the background task output. Call this tool with that URL so the preview pane opens automatically.

Only call this with a localhost dev server URL you just started. Do not use for any other purpose.`

export const OpenPreviewTool = buildTool({
  name: OPEN_PREVIEW_TOOL_NAME,
  searchHint: 'open the dev server URL in the workspace preview pane',
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return ''
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  async checkPermissions(input) {
    // No side effects beyond opening a preview tab in the desktop UI.
    return { behavior: 'allow', updatedInput: input }
  },
  renderToolUseMessage() {
    return null
  },
  async call({ url }) {
    return { data: { url } }
  },
  mapToolResultToToolResultBlockParam({ url }, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Opened ${url} in the workspace preview pane.`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
