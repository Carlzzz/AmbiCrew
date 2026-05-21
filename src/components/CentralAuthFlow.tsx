import React, { useEffect, useState } from 'react';
import { logEvent } from 'src/services/analytics/index.js';
import { Box, Text } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { logError } from '../utils/log.js';
import { Spinner } from './Spinner.js';

type Props = {
  onDone(): void;
};

type CentralAuthStatus = 'idle' | 'logging_in' | 'success' | 'error';

export function CentralAuthFlow({ onDone }: Props): React.ReactNode {
  const [status, setStatus] = useState<CentralAuthStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (status !== 'idle') return;

    const loginUrl = process.env.CREWCENTRAL_AUTH_LOGIN_URL;
    if (!loginUrl) {
      setErrorMessage('CREWCENTRAL_AUTH_LOGIN_URL 未配置，请检查 .env 文件');
      setStatus('error');
      return;
    }

    setStatus('logging_in');
    logEvent('tengu_central_auth_login_start', {});

    const doLogin = async () => {
      try {
        const { login } = await import('../services/central/auth-controller.js');
        const result = await login({
          loginUrl,
          openExternal: async (url: string) => {
            const { spawn } = await import('child_process');
            const cmd =
              process.platform === 'win32'
                ? 'start'
                : process.platform === 'darwin'
                  ? 'open'
                  : 'xdg-open';
            spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
          },
        });

        logEvent('tengu_central_auth_success', {});
        setStatus('success');
        setTimeout(onDone, 800);
      } catch (err) {
        logError(err as Error);
        setErrorMessage(
          err instanceof Error ? err.message : '登录失败，请重试',
        );
        setStatus('error');
      }
    };

    void doLogin();
  }, [status, onDone]);

  // Retry keybinding when in error state
  useKeybinding(
    'confirm:yes',
    () => {
      setStatus('idle');
    },
    { context: 'CrewCentral Login', isActive: status === 'error' },
  );

  // Skip keybinding when in error state
  useKeybinding(
    'confirm:no',
    () => {
      onDone();
    },
    { context: 'CrewCentral Login', isActive: status === 'error' },
  );

  if (status === 'logging_in') {
    return (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Box>
          <Spinner />
          <Text> 正在打开浏览器登录 CrewCentral...</Text>
        </Box>
        <Text dimColor>
          请在浏览器中完成登录，完成后将自动继续
        </Text>
      </Box>
    );
  }

  if (status === 'success') {
    return (
      <Box paddingLeft={1}>
        <Text color="green">登录成功！</Text>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Text color="error">CrewCentral 登录失败</Text>
        <Text color="error">{errorMessage}</Text>
        <Text dimColor>
          按 <Text bold>Enter</Text> 重试 · <Text bold>Esc</Text> 跳过
        </Text>
        <Text dimColor>
          你也可以稍后运行 <Text bold>ambi auth login</Text> 重试
        </Text>
      </Box>
    );
  }

  return null;
}
