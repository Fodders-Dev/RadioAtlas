# Working on this machine

This developer machine has two traps that cost real time every session until
they are known. Neither is inferable from the repository.

## The system ssh is broken — use Git's

`ssh`, `scp`, `sftp` and `ssh-keygen` from `C:\Windows\System32\OpenSSH` exit
with code 255 and **no output at all**, even for `ssh -V`. The binaries were
replaced by a Windows update on 2026-08-12; the signature is valid and the ACLs
are fine, so nothing looks wrong.

Always call Git's client by full path:

```bash
"/c/Program Files/Git/usr/bin/ssh.exe" -o BatchMode=yes rodnya '<command>'
```

An interactive PowerShell has a `$PROFILE` wrapper for this, but a
non-interactive shell does not pick it up. The permanent fix needs an
administrator (`Remove-WindowsCapability` / `Add-WindowsCapability` for
`OpenSSH.Client`), after which the wrapper can go.

## Backslashes are halved in transit

A command string passing through this tool layer loses one level of backslash
escaping before the shell sees it. `printf 'A\\B'` arrives as `A\B`; a Python
snippet written with `'a\\b'` receives a backspace character.

The damage is silent: a regex like `/[\\/]/` becomes `/[\/]/`, which still
compiles and quietly stops matching Windows paths.

- Writing code that contains backslashes (regex character classes, Windows
  paths, escape sequences): use the **Write or Edit tool**, not a heredoc.
- Verify with `cat -A` or by testing the behaviour, not by reading the echo of
  the command you just sent.
- Prefer constructions that avoid backslashes: `String.fromCharCode(10)` for a
  newline, `resolve()` + `pathToFileURL()` instead of hand-joined paths.

## Two shells, two syntaxes

Both are available. Bash (Git Bash, POSIX) is the default for scripts here;
PowerShell 7 is available for Windows-native work. Do not mix their syntax:
PowerShell has no `2>/dev/null`, no `head`/`tail`, and its here-strings need the
closing `'@` at column 0.

## Long-running work

Test suites and production probes take minutes. Run them with
`run_in_background: true` rather than chaining sleeps, and read the exit code
from the captured output rather than guessing from partial logs.
