import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { composePrompt, runOpencodeProcess, type SignalSource } from '../src/opencode.js';

type MockChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: (value: string) => void; end: () => void };
  killed: boolean;
  killSignals: Array<NodeJS.Signals | undefined>;
  kill: (signal?: NodeJS.Signals) => boolean;
};

function createMockChild(onEnd?: (child: MockChild) => void): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killSignals = [];
  child.stdin = {
    write: () => undefined,
    end: () => {
      if (onEnd) {
        onEnd(child);
      } else {
        setImmediate(() => child.emit('close', 0));
      }
    },
  };
  child.killed = false;
  child.kill = (signal?: NodeJS.Signals) => {
    child.killSignals.push(signal);
    child.killed = true;
    return true;
  };
  return child;
}

function spawnFromChild(
  child: MockChild,
  onSpawn?: (command: string, args: string[]) => void,
): typeof import('node:child_process').spawn {
  return ((command: string, args: string[]) => {
    onSpawn?.(command, args);
    return child;
  }) as unknown as typeof import('node:child_process').spawn;
}

test('composePrompt returns prompt unchanged when no instruction', () => {
  const out = composePrompt('Base prompt');
  assert.equal(out, 'Base prompt');
});

test('composePrompt appends instruction with spacing', () => {
  const out = composePrompt('Base prompt\n', 'Focus on tests');
  assert.equal(out, 'Base prompt\n\nFocus on tests\n');
});

test('composePrompt trims prompt trailing whitespace before appending instruction', () => {
  const out = composePrompt('Base prompt  \n  ', 'instruction');
  assert.equal(out, 'Base prompt\n\ninstruction\n');
});

test('composePrompt trims instruction whitespace', () => {
  const out = composePrompt('prompt', '  instruction  ');
  assert.equal(out, 'prompt\n\ninstruction\n');
});

test('runOpencodeProcess surfaces friendly ENOENT error', async () => {
  let message = '';
  await assert.rejects(async () => {
    try {
      await runOpencodeProcess({
        promptText: 'hello',
        cwd: process.cwd(),
        command: 'definitely-missing-opencode-bin',
        streamOutput: false,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }, /Could not find "definitely-missing-opencode-bin" in PATH/i);

  assert.match(message, /https:\/\/opencode\.ai/i);
  assert.match(message, /opencode --version/i);
});

test('runOpencodeProcess builds expected opencode args', async () => {
  const recorded: { command?: string; args?: string[] } = {};
  const child = createMockChild();
  const spawnImpl = spawnFromChild(child, (command, args) => {
    recorded.command = command;
    recorded.args = args;
  });

  await runOpencodeProcess({
    promptText: 'hello',
    cwd: process.cwd(),
    command: 'opencode-custom',
    spawnImpl,
    model: 'openai/gpt-5.3-codex',
    formatJson: true,
    printLogs: true,
    logLevel: 'DEBUG',
    streamOutput: false,
  });

  assert.equal(recorded.command, 'opencode-custom');
  assert.deepEqual(recorded.args, ['--print-logs', '--log-level', 'DEBUG', 'run', '-m', 'openai/gpt-5.3-codex', '--format', 'json']);
});

test('runOpencodeProcess defaults to JSON format when omitted', async () => {
  const recorded: { args?: string[] } = {};
  const child = createMockChild();
  const spawnImpl = spawnFromChild(child, (_, args) => {
    recorded.args = args;
  });

  await runOpencodeProcess({
    promptText: 'hello',
    cwd: process.cwd(),
    spawnImpl,
    streamOutput: false,
  });

  assert.deepEqual(recorded.args, ['run', '--format', 'json']);
});

test('runOpencodeProcess supports format parameter for jsonl', async () => {
  const recorded: { args?: string[] } = {};
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child, (_, args) => {
    recorded.args = args;
  });

  await runOpencodeProcess({
    promptText: 'hello',
    cwd: process.cwd(),
    spawnImpl,
    streamOutput: false,
    format: 'jsonl',
  });

  assert.deepEqual(recorded.args, ['run', '--format', 'json']);
});

test('runOpencodeProcess supports format parameter for raw output', async () => {
  const recorded: { args?: string[] } = {};
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child, (_, args) => {
    recorded.args = args;
  });

  await runOpencodeProcess({
    promptText: 'hello',
    cwd: process.cwd(),
    spawnImpl,
    streamOutput: false,
    format: 'raw',
  });

  assert.deepEqual(recorded.args, ['run']);
});

test('runOpencodeProcess returns pretty text in non-stream JSON mode', async () => {
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.stdout.emit('data', Buffer.from('{"type":"text","part":{"text":"hello world"}}\n'));
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  const result = await runOpencodeProcess({
    promptText: 'hello',
    cwd: process.cwd(),
    spawnImpl,
    streamOutput: false,
    formatJson: true,
    prettyEvents: true,
  });

  assert.equal(result, 'hello world');
});

test('runOpencodeProcess returns pretty text in stream JSON mode', async () => {
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.stdout.emit('data', Buffer.from('{"type":"text","part":{"text":"stream text"}}\n'));
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (() => true) as typeof process.stdout.write;

  let result = '';
  try {
    result = await runOpencodeProcess({
      promptText: 'hello',
      cwd: process.cwd(),
      spawnImpl,
      streamOutput: true,
      formatJson: true,
      prettyEvents: true,
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.equal(result, 'stream text');
});

test('runOpencodeProcess includes tool output in rendered text', async () => {
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.stdout.emit(
        'data',
        Buffer.from('{"type":"tool_use","part":{"tool":"read","state":{"title":"file","output":"line1\\nline2"}}}\n'),
      );
      mock.stdout.emit('data', Buffer.from('{"type":"text","part":{"text":"done"}}\n'));
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  const result = await runOpencodeProcess({
    promptText: 'hello',
    cwd: process.cwd(),
    spawnImpl,
    streamOutput: false,
    formatJson: true,
    prettyEvents: true,
    showToolOutput: true,
  });

  assert.equal(result, 'tool · read file — 2 lines\ndone');
});

test('runOpencodeProcess formats read tool tagged output for readability', async () => {
  const taggedOutput = `<path>/tmp/example.md</path>\n<type>file</type>\n<content>1: hello\n2: world</content>`;
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.stdout.emit(
        'data',
        Buffer.from(`{"type":"tool_use","part":{"tool":"read","state":{"title":"example","output":${JSON.stringify(taggedOutput)}}}}\n`),
      );
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  const result = await runOpencodeProcess({
    promptText: 'hello',
    cwd: process.cwd(),
    spawnImpl,
    streamOutput: false,
    formatJson: true,
    prettyEvents: true,
    showToolOutput: true,
  });

  assert.equal(result, 'tool · read example — example.md (2 lines)');
});

test('runOpencodeProcess summarizes glob tool output for readability', async () => {
  const globOutput = ['/tmp/a.ts', '/tmp/b.ts', '/tmp/c.ts'].join('\n');
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.stdout.emit(
        'data',
        Buffer.from(`{"type":"tool_use","part":{"tool":"glob","state":{"title":"scan","output":${JSON.stringify(globOutput)}}}}\n`),
      );
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  const result = await runOpencodeProcess({
    promptText: 'hello',
    cwd: process.cwd(),
    spawnImpl,
    streamOutput: false,
    formatJson: true,
    prettyEvents: true,
    showToolOutput: true,
  });

  assert.equal(result, 'tool · glob scan — 3 paths');
});

test('runOpencodeProcess summarizes bash tool output in one line when possible', async () => {
  const bashOutput = [
    'backend/app/a.py | 10 +++-',
    'backend/app/b.py | 9 ++-',
    '2 files changed, 14 insertions(+), 5 deletions(-)',
  ].join('\n');
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.stdout.emit(
        'data',
        Buffer.from(`{"type":"tool_use","part":{"tool":"bash","state":{"title":"Get diff statistics","output":${JSON.stringify(bashOutput)}}}}\n`),
      );
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  const result = await runOpencodeProcess({
    promptText: 'hello',
    cwd: process.cwd(),
    spawnImpl,
    streamOutput: false,
    formatJson: true,
    prettyEvents: true,
    showToolOutput: true,
  });

  assert.equal(result, 'tool · bash Get diff statistics — 2 files changed, 14 insertions(+), 5 deletions(-)');
});

test('runOpencodeProcess compacts long read tagged content', async () => {
  const taggedOutput = `<path>/tmp/huge.md</path>\n<type>file</type>\n<content>${Array.from({ length: 10 }, (_, i) => `${i + 1}: line`).join('\n')}</content>`;
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.stdout.emit(
        'data',
        Buffer.from(`{"type":"tool_use","part":{"tool":"read","state":{"title":"huge.md","output":${JSON.stringify(taggedOutput)}}}}\n`),
      );
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  const result = await runOpencodeProcess({
    promptText: 'hello',
    cwd: process.cwd(),
    spawnImpl,
    streamOutput: false,
    formatJson: true,
    prettyEvents: true,
    showToolOutput: true,
  });

  assert.equal(
    result,
    'tool · read huge.md — huge.md (10 lines)',
  );
});

test('runOpencodeProcess returns json-final object with text and tool results', async () => {
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.stdout.emit(
        'data',
        Buffer.from('{"type":"tool_use","part":{"tool":"read","state":{"title":"file","output":"line1"}}}\n'),
      );
      mock.stdout.emit('data', Buffer.from('{"type":"text","part":{"text":"done"}}\n'));
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  const result = await runOpencodeProcess({
    promptText: 'hello',
    cwd: process.cwd(),
    spawnImpl,
    streamOutput: false,
    format: 'json-final',
  });

  const parsed = JSON.parse(result) as {
    text: string;
    toolResults: Array<{ tool: string; title?: string; output?: unknown }>;
    events: unknown[];
  };
  assert.equal(parsed.text, 'done');
  assert.equal(parsed.toolResults.length, 1);
  assert.equal(parsed.toolResults[0]?.tool, 'read');
  assert.equal(parsed.toolResults[0]?.title, 'file');
  assert.equal(parsed.toolResults[0]?.output, 'line1');
  assert.equal(parsed.events.length, 2);
});

test('runOpencodeProcess forwards signals to child and cleans up listeners', async () => {
  const signalSource = new EventEmitter() as EventEmitter & SignalSource;
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  const runPromise = runOpencodeProcess({
    promptText: 'hello',
    cwd: process.cwd(),
    spawnImpl,
    streamOutput: false,
    signalSource,
    formatJson: false,
  });

  signalSource.emit('SIGINT', 'SIGINT');
  await runPromise;

  assert.deepEqual(child.killSignals, ['SIGINT']);
  assert.equal(signalSource.listenerCount('SIGINT'), 0);
  assert.equal(signalSource.listenerCount('SIGTERM'), 0);
});

test('runOpencodeProcess rejects when error event is emitted', async () => {
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.stdout.emit('data', Buffer.from('{"type":"error","error":{"message":"bad session"}}\n'));
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  await assert.rejects(
    () =>
      runOpencodeProcess({
        promptText: 'hello',
        cwd: process.cwd(),
        spawnImpl,
        streamOutput: false,
        formatJson: true,
        prettyEvents: true,
      }),
    /bad session/i,
  );
});

test('runOpencodeProcess extracts session id from JSON events', async () => {
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.stdout.emit(
        'data',
        Buffer.from('{"type":"step_start","sessionID":"ses_123","part":{"text":"start"}}\n{"type":"text","sessionID":"ses_123","part":{"text":"hello"}}\n'),
      );
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  let seenSessionId = '';
  await runOpencodeProcess({
    promptText: 'hello',
    cwd: process.cwd(),
    spawnImpl,
    streamOutput: false,
    formatJson: true,
    prettyEvents: true,
    onSessionId: value => {
      seenSessionId = value;
    },
  });

  assert.equal(seenSessionId, 'ses_123');
});

test('runOpencodeProcess rejects on non-zero exit code', async () => {
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.stderr.emit('data', Buffer.from('Something went wrong'));
      mock.emit('close', 1);
    });
  });
  const spawnImpl = spawnFromChild(child);

  await assert.rejects(
    () =>
      runOpencodeProcess({
        promptText: 'hello',
        cwd: process.cwd(),
        spawnImpl,
        streamOutput: false,
        formatJson: false,
      }),
    /opencode exited with code 1: Something went wrong/,
  );
});

test('runOpencodeProcess rejects on non-zero exit code without stderr', async () => {
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.emit('close', 2);
    });
  });
  const spawnImpl = spawnFromChild(child);

  await assert.rejects(
    () =>
      runOpencodeProcess({
        promptText: 'hello',
        cwd: process.cwd(),
        spawnImpl,
        streamOutput: false,
        formatJson: false,
      }),
    /opencode exited with code 2/,
  );
});

test('runOpencodeProcess invokes onStdout callback', async () => {
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.stdout.emit('data', Buffer.from('stdout data'));
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  let capturedStdout = '';
  await runOpencodeProcess({
    promptText: 'hello',
    cwd: process.cwd(),
    spawnImpl,
    streamOutput: false,
    formatJson: false,
    onStdout: chunk => {
      capturedStdout += chunk;
    },
  });

  assert.equal(capturedStdout, 'stdout data');
});

test('runOpencodeProcess invokes onStderr callback', async () => {
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.stderr.emit('data', Buffer.from('error data'));
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  let capturedStderr = '';
  await runOpencodeProcess({
    promptText: 'hello',
    cwd: process.cwd(),
    spawnImpl,
    streamOutput: false,
    formatJson: false,
    onStderr: chunk => {
      capturedStderr += chunk;
    },
  });

  assert.equal(capturedStderr, 'error data');
});

test('runOpencodeProcess returns raw stdout when formatJson is false', async () => {
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.stdout.emit('data', Buffer.from('raw output'));
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  const result = await runOpencodeProcess({
    promptText: 'hello',
    cwd: process.cwd(),
    spawnImpl,
    streamOutput: false,
    formatJson: false,
  });

  assert.equal(result, 'raw output');
});

test('runOpencodeProcess handles multiple JSON lines in stream mode', async () => {
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.stdout.emit('data', Buffer.from('{"type":"text","part":{"text":"line1"}}\n'));
      mock.stdout.emit('data', Buffer.from('{"type":"text","part":{"text":"line2"}}\n'));
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (() => true) as typeof process.stdout.write;

  let result = '';
  try {
    result = await runOpencodeProcess({
      promptText: 'hello',
      cwd: process.cwd(),
      spawnImpl,
      streamOutput: true,
      formatJson: true,
      prettyEvents: true,
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.equal(result, 'line1\nline2');
});

test('runOpencodeProcess highlights thinking lines for configured models', async () => {
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.stdout.emit(
        'data',
        Buffer.from('{"type":"text","part":{"text":"_Thinking:_\\n\\nInternal note\\n\\nFinal answer"}}\n'),
      );
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  const originalWrite = process.stdout.write.bind(process.stdout);
  let rendered = '';
  process.stdout.write = ((chunk: string | Uint8Array) => {
    rendered += chunk.toString();
    return true;
  }) as typeof process.stdout.write;

  try {
    await runOpencodeProcess({
      promptText: 'hello',
      cwd: process.cwd(),
      spawnImpl,
      streamOutput: true,
      formatJson: true,
      prettyEvents: true,
      model: 'openai/gpt-5.3-codex',
      thinkingModels: ['openai/gpt-5.3-codex'],
      thinkingColor: 'magenta',
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  const colorEnabled = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
  if (colorEnabled) {
    assert.match(rendered, /\u001b\[35m_Thinking:_\u001b\[0m/);
    assert.match(rendered, /\u001b\[35mInternal note\u001b\[0m/);
  } else {
    assert.match(rendered, /_Thinking:_/);
    assert.match(rendered, /Internal note/);
  }
});

test('runOpencodeProcess forwards SIGTERM signal', async () => {
  const signalSource = new EventEmitter() as EventEmitter & SignalSource;
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  const runPromise = runOpencodeProcess({
    promptText: 'hello',
    cwd: process.cwd(),
    spawnImpl,
    streamOutput: false,
    signalSource,
    formatJson: false,
  });

  signalSource.emit('SIGTERM', 'SIGTERM');
  await runPromise;

  assert.deepEqual(child.killSignals, ['SIGTERM']);
});

test('runOpencodeProcess captures stderr in non-stream mode', async () => {
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.stderr.emit('data', Buffer.from('error output'));
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  await runOpencodeProcess({
    promptText: 'hello',
    cwd: process.cwd(),
    spawnImpl,
    streamOutput: false,
    formatJson: false,
  });
});

test('runOpencodeProcess handles tool_use with empty state', async () => {
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.stdout.emit('data', Buffer.from('{"type":"tool_use","part":{"tool":"bash"}}\n'));
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  const result = await runOpencodeProcess({
    promptText: 'hello',
    cwd: process.cwd(),
    spawnImpl,
    streamOutput: false,
    formatJson: true,
    prettyEvents: true,
  });

  assert.equal(result, 'tool · bash');
});

test('runOpencodeProcess fail-fast policy blocks on running question tool', async () => {
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.stdout.emit(
        'data',
        Buffer.from('{"type":"tool_use","part":{"tool":"question","state":{"status":"running","input":{"question":"Need email?"}}}}\n'),
      );
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  const terminalStateRef: { value?: { status: string; tool?: string; input?: string } } = {};
  await assert.rejects(
    () =>
      runOpencodeProcess({
        promptText: 'hello',
        cwd: process.cwd(),
        spawnImpl,
        streamOutput: false,
        formatJson: true,
        prettyEvents: true,
        questionPolicy: 'fail-fast',
        onTerminalState: state => {
          terminalStateRef.value = state;
        },
      }),
    /Blocked on interactive question tool/i,
  );

  assert.deepEqual(child.killSignals, ['SIGTERM']);
  const terminalState = terminalStateRef.value;
  assert.ok(terminalState);
  assert.equal(terminalState.status, 'blocked');
  assert.equal(terminalState.tool, 'question');
  assert.match(terminalState.input || '', /Need email\?/);
});

test('runOpencodeProcess abort policy stops on running question tool without throwing', async () => {
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.stdout.emit(
        'data',
        Buffer.from('{"type":"tool_use","part":{"tool":"question","state":{"status":"running","input":{"question":"Need email?"}}}}\n'),
      );
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  const terminalStateRef: { value?: { status: string; tool?: string; input?: string } } = {};
  const result = await runOpencodeProcess({
    promptText: 'hello',
    cwd: process.cwd(),
    spawnImpl,
    streamOutput: false,
    formatJson: true,
    prettyEvents: true,
    questionPolicy: 'abort',
    onTerminalState: state => {
      terminalStateRef.value = state;
    },
  });

  assert.deepEqual(child.killSignals, ['SIGTERM']);
  assert.equal(result, 'tool · question {"question":"Need email?"}');
  const terminalState = terminalStateRef.value;
  assert.ok(terminalState);
  assert.equal(terminalState.status, 'blocked');
  assert.equal(terminalState.tool, 'question');
});

test('runOpencodeProcess default-answer policy completes when question tool resolves', async () => {
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.stdout.emit(
        'data',
        Buffer.from(
          '{"type":"tool_use","part":{"tool":"question","state":{"status":"running","input":{"question":"Need email?"}}}}\n' +
            '{"type":"tool_use","part":{"tool":"question","state":{"status":"completed","output":{"answer":"Use default"}}}}\n' +
            '{"type":"text","part":{"text":"sent"}}\n',
        ),
      );
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  const terminalStateRef: { value?: { status: string; tool?: string; input?: string } } = {};
  const result = await runOpencodeProcess({
    promptText: 'hello',
    cwd: process.cwd(),
    spawnImpl,
    streamOutput: false,
    formatJson: true,
    prettyEvents: true,
    questionPolicy: 'default-answer',
    onTerminalState: state => {
      terminalStateRef.value = state;
    },
  });

  assert.deepEqual(child.killSignals, []);
  assert.equal(result, 'tool · question {"question":"Need email?"}\ntool · question\nsent');
  const terminalState = terminalStateRef.value;
  assert.ok(terminalState);
  assert.equal(terminalState.status, 'completed');
});

test('runOpencodeProcess handles error event from stderr in non-stream mode', async () => {
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.stdout.emit('data', Buffer.from('{"type":"error","error":{"message":"session failed"}}\n'));
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  await assert.rejects(
    () =>
      runOpencodeProcess({
        promptText: 'hello',
        cwd: process.cwd(),
        spawnImpl,
        streamOutput: false,
        formatJson: true,
        prettyEvents: true,
      }),
    /session failed/i,
  );
});

test('runOpencodeProcess keeps valid JSON events when malformed lines are mixed in stream output', async () => {
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.stdout.emit(
        'data',
        Buffer.from('{"type":"text","part":{"text":"first"}}\n{not-json}\n{"type":"text","part":{"text":"second"}}\n'),
      );
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (() => true) as typeof process.stdout.write;

  let result = '';
  try {
    result = await runOpencodeProcess({
      promptText: 'hello',
      cwd: process.cwd(),
      spawnImpl,
      streamOutput: true,
      formatJson: true,
      prettyEvents: true,
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.equal(result, 'first\n{not-json}\nsecond');
});

test('runOpencodeProcess collapses very large tool output lines', async () => {
  const hugeOutput = 'A'.repeat(1024 * 1024 + 128);
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.stdout.emit(
        'data',
        Buffer.from(`{"type":"tool_use","part":{"tool":"read","state":{"title":"huge","output":"${hugeOutput}"}}}\n`),
      );
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  const result = await runOpencodeProcess({
    promptText: 'hello',
    cwd: process.cwd(),
    spawnImpl,
    streamOutput: false,
    formatJson: true,
    prettyEvents: true,
    showToolOutput: true,
  });

  const lines = result.split('\n');
  assert.equal(lines[0], 'tool · read huge — 1 line');
});

test('runOpencodeProcess extracts session id from varied line positions', async () => {
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.stdout.emit('data', Buffer.from('{"type":"text","part":{"text":"before"}}\n'));
      mock.stdout.emit('data', Buffer.from('{"type":"text","sessionID":"ses_middle","part":{"text":"during"}}'));
      mock.stdout.emit('data', Buffer.from('\n{"type":"text","sessionID":"ses_last","part":{"text":"after"}}'));
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  const seenSessionIds: string[] = [];
  await runOpencodeProcess({
    promptText: 'hello',
    cwd: process.cwd(),
    spawnImpl,
    streamOutput: false,
    formatJson: true,
    prettyEvents: true,
    onSessionId: value => {
      seenSessionIds.push(value);
    },
  });

  assert.deepEqual(seenSessionIds, ['ses_middle']);
});

test('runOpencodeProcess renders nested JSON tool output when showToolOutput is enabled', async () => {
  const nestedOutput = {
    result: {
      files: ['a.ts', 'b.ts'],
      meta: { ok: true, count: 2 },
    },
  };
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.stdout.emit(
        'data',
        Buffer.from(
          `{"type":"tool_use","part":{"tool":"grep","state":{"title":"scan","output":${JSON.stringify(JSON.stringify(nestedOutput))}}}}\n`,
        ),
      );
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  const result = await runOpencodeProcess({
    promptText: 'hello',
    cwd: process.cwd(),
    spawnImpl,
    streamOutput: false,
    formatJson: true,
    prettyEvents: true,
    showToolOutput: true,
  });

  assert.match(result, /tool · grep scan/);
  assert.match(result, /"files":?\[/);
  assert.match(result, /"a.ts"/);
  assert.match(result, /"meta":?\{/);
  assert.match(result, /"count":?2/);
});

test('runOpencodeProcess highlights thinking blocks with unusual markdown header formatting', async () => {
  const child = createMockChild(mock => {
    setImmediate(() => {
      mock.stdout.emit(
        'data',
        Buffer.from('{"type":"text","part":{"text":"**_Thinking:_**\\n\\nDraft plan\\n\\nFinal answer"}}\n'),
      );
      mock.emit('close', 0);
    });
  });
  const spawnImpl = spawnFromChild(child);

  const originalWrite = process.stdout.write.bind(process.stdout);
  let rendered = '';
  process.stdout.write = ((chunk: string | Uint8Array) => {
    rendered += chunk.toString();
    return true;
  }) as typeof process.stdout.write;

  try {
    await runOpencodeProcess({
      promptText: 'hello',
      cwd: process.cwd(),
      spawnImpl,
      streamOutput: true,
      formatJson: true,
      prettyEvents: true,
      model: 'openai/gpt-5.3-codex',
      thinkingModels: ['openai/gpt-5.3-codex'],
      thinkingColor: 'magenta',
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  const colorEnabled = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
  if (colorEnabled) {
    assert.match(rendered, /\u001b\[35m\*\*_Thinking:_\*\*\u001b\[0m/);
    assert.match(rendered, /\u001b\[35mDraft plan\u001b\[0m/);
    assert.doesNotMatch(rendered, /\u001b\[35mFinal answer\u001b\[0m/);
  } else {
    assert.match(rendered, /\*\*_Thinking:_\*\*/);
    assert.match(rendered, /Draft plan/);
    assert.match(rendered, /Final answer/);
  }
});
