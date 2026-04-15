/**
 * Representative Junos CLI prompt and pagination fixtures.
 */

// Operational mode prompts
export const PROMPT_OP_SIMPLE = 'user@switch> ';
export const PROMPT_OP_WITH_OUTPUT = 'show version\nJunos: 21.4R3\nuser@switch> ';
export const PROMPT_OP_DASHES = 'root@EX2300-24P> ';

// Configuration mode prompts
export const PROMPT_CONFIG = 'user@switch# ';
export const PROMPT_CONFIG_WITH_OUTPUT = 'show | compare\n+ set interfaces ge-0/0/0\nuser@switch# ';

// Shell prompt
export const PROMPT_SHELL = 'root@switch% ';

// Login/password prompts
export const PROMPT_LOGIN = 'login: ';
export const PROMPT_PASSWORD = 'Password: ';
export const PROMPT_PASSWORD_LOWER = 'password: ';

// --More-- pagination markers — must match MORE_PATTERN: /---\(more\s*\d*%?\)---/i
export const MORE_STANDARD = '---(more)---';
export const MORE_WITH_PERCENT = '---(more 42%)---';
export const MORE_ALT = '--(more)--';

// Not a prompt — command output only
export const NOT_A_PROMPT_PLAIN = 'Junos: 21.4R3\nHostname: switch-01\n';
export const NOT_A_PROMPT_MID_LINE = 'user@switch> show version\nJunos 21.4R3';

// Command echo followed by output and trailing prompt
export const CMD_WITH_ECHO = 'show version\r\nJunos: 21.4R3\r\nuser@switch> ';
