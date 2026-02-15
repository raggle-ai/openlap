import { getExampleNames } from './example.js';

export type CompletionShell = 'bash' | 'zsh' | 'fish';

const ALL_FLAGS = [
  '-f',
  '--file',
  '-i',
  '--instruction',
  '-m',
  '--model',
  '-C',
  '--cwd',
  '-c',
  '--copy',
  '--example',
  '--list-examples',
  '--completions',
  '--doctor',
  '--output-format',
  '--raw',
  '--no-pretty',
  '--show-tool-output',
  '--no-interactive',
  '--print-logs',
  '--log-level',
  '--no-stream',
  '--thinking-models',
  '--thinking-color',
  '-v',
  '--version',
  '-h',
  '--help',
];

const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;
const THINKING_COLORS = ['yellow', 'cyan', 'magenta', 'blue', 'gray'] as const;
const OUTPUT_FORMATS = ['pretty', 'raw', 'json-events', 'json-final', 'jsonl'] as const;
const COMPLETION_SHELLS: CompletionShell[] = ['bash', 'zsh', 'fish'];

export function isCompletionShell(value: string): value is CompletionShell {
  return COMPLETION_SHELLS.includes(value as CompletionShell);
}

export function getCompletionScript(shell: CompletionShell): string {
  const examples = getExampleNames();
  if (shell === 'bash') {
    return renderBashCompletion(examples);
  }
  if (shell === 'zsh') {
    return renderZshCompletion(examples);
  }
  return renderFishCompletion(examples);
}

function renderBashCompletion(exampleNames: string[]): string {
  const flags = ALL_FLAGS.join(' ');
  const examples = exampleNames.join(' ');
  const shells = COMPLETION_SHELLS.join(' ');
  const levels = LOG_LEVELS.join(' ');
  const colors = THINKING_COLORS.join(' ');
  const outputFormats = OUTPUT_FORMATS.join(' ');

  return `# openlap bash completion
_openlap_completions() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  local flags="${flags}"
  local examples="${examples}"
  local shells="${shells}"
  local levels="${levels}"
  local colors="${colors}"
  local output_formats="${outputFormats}"

  case "\${prev}" in
    --example)
      COMPREPLY=( $(compgen -W "\${examples}" -- "\${cur}") )
      return
      ;;
    --completions)
      COMPREPLY=( $(compgen -W "\${shells}" -- "\${cur}") )
      return
      ;;
    --output-format)
      COMPREPLY=( $(compgen -W "\${output_formats}" -- "\${cur}") )
      return
      ;;
    --log-level)
      COMPREPLY=( $(compgen -W "\${levels}" -- "\${cur}") )
      return
      ;;
    --thinking-color)
      COMPREPLY=( $(compgen -W "\${colors}" -- "\${cur}") )
      return
      ;;
    -f|--file|-C|--cwd)
      COMPREPLY=( $(compgen -f -- "\${cur}") )
      return
      ;;
  esac

  COMPREPLY=( $(compgen -W "\${flags}" -- "\${cur}") )
}

complete -F _openlap_completions openlap
`;
}

function renderZshCompletion(exampleNames: string[]): string {
  const examples = exampleNames.join(' ');
  const shells = COMPLETION_SHELLS.join(' ');
  const levels = LOG_LEVELS.join(' ');
  const colors = THINKING_COLORS.join(' ');
  const outputFormats = OUTPUT_FORMATS.join(' ');

  return `#compdef openlap

_openlap() {
  local -a examples shells levels colors
  examples=(${examples})
  shells=(${shells})
  levels=(${levels})
  colors=(${colors})

  _arguments -s \\
    '(-h --help)'{-h,--help}'[Show help]' \\
    '(-v --version)'{-v,--version}'[Show version]' \\
    '--list-examples[Show built-in examples]' \\
    '--raw[Disable JSON output format]' \\
    '--no-pretty[Disable pretty event rendering]' \\
    '--show-tool-output[Print tool output lines]' \\
    '--no-interactive[Skip launching interactive OpenCode after run]' \\
    '--print-logs[Enable OpenCode logs]' \\
    '--no-stream[Return only final output]' \\
    '(-c --copy)'{-c,--copy}'[Read prompt from clipboard]' \\
    '(-f --file)'{-f,--file}'[Read prompt text from a file]:file:_files' \\
    '(-i --instruction)'{-i,--instruction}'[Append extra instruction to prompt]:instruction:' \\
    '(-m --model)'{-m,--model}'[OpenCode model id]:model:' \\
    '(-C --cwd)'{-C,--cwd}'[Working directory for opencode run]:directory:_files -/' \\
    '--example[Use a built-in example query]:example:(${examples})' \\
    '--completions[Print completion script for shell]:shell:(${shells})' \\
    '--doctor[Run environment diagnostics]' \\
    '--output-format[Output format]:format:(${outputFormats})' \\
    '--log-level[OpenCode log level]:level:(${levels})' \\
    '--thinking-models[CSV of models that get thinking highlight]:models:' \\
    '--thinking-color[Thinking highlight color]:color:(${colors})' \\
    '*:prompt text:'
}

_openlap "$@"
`;
}

function renderFishCompletion(exampleNames: string[]): string {
  const examples = exampleNames.join(' ');

  return `# openlap fish completion
complete -c openlap -s h -l help -d 'Show help'
complete -c openlap -s v -l version -d 'Show version'
complete -c openlap -s f -l file -r -d 'Read prompt text from a file'
complete -c openlap -s i -l instruction -r -d 'Append extra instruction to the prompt'
complete -c openlap -s m -l model -r -d 'OpenCode model id'
complete -c openlap -s C -l cwd -r -d 'Working directory for opencode run'
complete -c openlap -s c -l copy -d 'Read prompt from clipboard'
complete -c openlap -l example -r -a '${examples}' -d 'Use a built-in example query'
complete -c openlap -l list-examples -d 'Show built-in examples'
complete -c openlap -l completions -r -a 'bash zsh fish' -d 'Print completion script for shell'
complete -c openlap -l doctor -d 'Run environment diagnostics'
complete -c openlap -l output-format -r -a 'pretty raw json-events json-final jsonl' -d 'Output format'
complete -c openlap -l raw -d 'Disable JSON output format'
complete -c openlap -l no-pretty -d 'Disable pretty event rendering'
complete -c openlap -l show-tool-output -d 'Print tool output lines'
complete -c openlap -l no-interactive -d 'Skip launching interactive OpenCode after run'
complete -c openlap -l print-logs -d 'Enable OpenCode logs'
complete -c openlap -l log-level -r -a 'DEBUG INFO WARN ERROR' -d 'OpenCode log level'
complete -c openlap -l no-stream -d 'Return only final output'
complete -c openlap -l thinking-models -r -d 'CSV of models that get thinking highlight'
complete -c openlap -l thinking-color -r -a 'yellow cyan magenta blue gray' -d 'Thinking highlight color'
`;
}
