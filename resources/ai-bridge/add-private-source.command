#!/bin/zsh
set -e
source_directory="$(cd -- "$(dirname -- "$0")" && pwd)"
printf 'Adding the private Fidra source to ChatGPT/Codex.\nNo ledger access is granted by this step.\n\n'
if ! command -v codex >/dev/null 2>&1; then
  printf 'The Codex source-registration command is unavailable in this Terminal.\nRead INSTALL.md for the project-local installation option.\n'
  printf '\nPress Return to close.'
  read -r reply
  exit 1
fi
codex plugin marketplace add "$source_directory"
printf '\nSource added. Restart ChatGPT desktop, open Plugins, choose the Fidra source, and install Fidra.\nRun Fidra setup there; an administrator approves access inside Fidra.\nKeep this folder in its current location.\n'
printf '\nPress Return to close.'
read -r reply
