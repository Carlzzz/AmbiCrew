import { getBundledSkillExtractDir, registerBundledSkill } from '../bundledSkills.js'
// @ts-ignore - Bun text import (embeds the plugin source at compile time)
import PREVIEW_EDIT_PLUGIN_SOURCE from './preview-edit/ambicrew-source-locator.js' with { type: 'text' }
// @ts-ignore - Bun text import (shared picker script)
import PICKER_SOURCE from './preview-edit/picker.js' with { type: 'text' }

const SKILL_PROMPT = `# Preview Edit - Scaffold a live-preview Vite project (__FRAMEWORK__)

Goal: scaffold a Vite + __FRAMEWORK__ (TypeScript) project pre-wired with the
AmbiCrew source-locator plugin, start its dev server, and open the preview.
Once running, the user can click any element in the preview - its source
file:line lands in the chat as a context chip so you can edit precisely.

## Steps

1. Scaffold into the current directory (the session project root = your cwd)
   so the Vite root matches cwd and picked source paths resolve. Skip if
   vite.config.ts already exists. Run with Bash:

       npm create vite@latest . -- --template __FRAMEWORK__-ts

   The current directory should be empty. If create-vite warns about a
   non-empty directory, confirm (or pick an empty folder).

2. Copy the source-locator plugin AND the picker into the project root. Both
   are bundled with this skill in its base directory (see "Base directory for
   this skill" above): ambicrew-source-locator.js and picker.js. Copy both to
   the project with Bash, e.g.:

       cp "<base-dir>/ambicrew-source-locator.js" ./ambicrew-source-locator.js
       cp "<base-dir>/picker.js" ./picker.js

   (use the actual base-directory path printed above for <base-dir>)

3. Register the plugin in vite.config.ts with FileEdit. The scaffolded config
   already has the __FRAMEWORK__ framework plugin. Add an import and append
   ambicrewSourceLocator() to the plugins array:

       import ambicrewSourceLocator from './ambicrew-source-locator.js'
       // ...
       plugins: [<framework-plugin>(), ambicrewSourceLocator()],

4. Install dependencies with Bash:  npm install
   The plugin needs @babel/parser and magic-string (transitive via vite). If
   resolution fails: npm install -D @babel/parser magic-string

5. Start the dev server in the background (Bash, run_in_background: true):

       npm run dev -- --host 127.0.0.1

   Read the background task output to find the local URL (e.g.
   http://127.0.0.1:5173/ ). Call the OpenPreview tool with it - the preview
   pane opens automatically.

6. Tell the user the preview is open and how to use it:
   - Click the pick (my_location) toggle in the preview toolbar to arm it.
   - Click any element - its file:line appears as a context chip in the chat.
   - Then describe the change; you edit the located source file.
   - Use the undo (rewind) button to revert an edit.

7. If a user development request is provided below, implement it now: edit the
   scaffolded app's source with FileEdit. The dev server is running and the
   preview is open, so each edit refreshes via HMR. The user can also click
   elements to locate source for further edits.

## Notes
- The plugin handles React (.jsx/.tsx), Vue (.vue), Svelte (.svelte), and HTML
  (.html) - injecting data-source on elements. Picked paths are relative to the
  Vite root (= your cwd), so reference them as @<path> with the given line.
- Two pick kinds: with file:line (this plugin, direct mode) -> edit that line;
  without (proxy mode, arbitrary pages) -> Grep for selector/text/outerHTML.
- The plugin only runs in dev (apply: serve); builds are unaffected.`

export function registerPreviewEditSkill(): void {
  registerBundledSkill({
    name: 'preview-edit',
    description:
      'Scaffold a Vite + React/Vue/Svelte project wired with a source-locator plugin and start its dev server, enabling click-an-element-in-the-preview -> locate source code in the AmbiCrew workspace preview pane.',
    whenToUse:
      'Use when the user wants a live visual preview of a frontend project where clicking a UI element locates its source code for AI editing. Scaffolds a new Vite + React/Vue/Svelte (TypeScript) project with the AmbiCrew source-locator plugin and starts the dev server.',
    userInvocable: true,
    files: {
      'ambicrew-source-locator.js': PREVIEW_EDIT_PLUGIN_SOURCE,
      'picker.js': PICKER_SOURCE,
    },
    async getPromptForCommand(args) {
      let framework = 'react'
      let request = args
      if (args) {
        const m = args.match(/^\s*(react|vue|svelte)\b\s*/i)
        if (m) {
          framework = m[1]!.toLowerCase()
          request = args.slice(m[0].length)
        }
      }
      let prompt = SKILL_PROMPT.replace(/__FRAMEWORK__/g, framework)
      if (request && request.trim()) {
        prompt += `\n\n## User's development request\n\n${request.trim()}`
      }
      // Keep the historical no-op substitution for safety.
      prompt = prompt.replace(
        /\$\{CLAUDE_SKILL_DIR\}/g,
        getBundledSkillExtractDir('preview-edit'),
      )
      return [{ type: 'text', text: prompt }]
    },
  })
}
