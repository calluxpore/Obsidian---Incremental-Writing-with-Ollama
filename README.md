# Incremental Writing with Ollama

An Obsidian plugin for growing ideas into finished writing a little at a time.

- A **writing queue** in the sidebar brings drafts back for another pass on a spaced-repetition schedule.
- Each review adds a **task to the daily note** for the next review date, so reviews show up in your daily notes, the Calendar plugin, and Tasks queries.
- Four **AI writing commands** use a local [Ollama](https://ollama.com) model (`mistral-nemo` by default) to critique, bridge, outline, and refactor your drafts.

Everything runs on your machine. See [Privacy](#privacy).

---

## Contents

- [How it works](#how-it-works)
- [Installation](#installation)
- [Quick start](#quick-start)
- [The writing queue](#the-writing-queue)
- [Daily note tasks](#daily-note-tasks)
- [AI commands](#ai-commands)
- [All commands](#all-commands)
- [Settings](#settings)
- [Troubleshooting](#troubleshooting)
- [Privacy](#privacy)
- [Development](#development)
- [Releasing a new version](#releasing-a-new-version)
- [License](#license)

---

## How it works

Incremental writing treats a piece of writing like a flashcard. Instead of finishing an essay in one sitting, you:

1. **Capture** an idea as a small note (a *seed*).
2. **Revisit** it when it comes due, and spend a short sprint expanding, questioning, or restructuring it.
3. **Grade** the session. Notes that need work come back soon; notes in good shape come back later.

Over weeks, seeds grow into drafts and drafts into finished (*evergreen*) pieces, and the queue decides what to work on each day.

---

## Installation

### Requirements

- Obsidian **1.7.2** or later
- [Ollama](https://ollama.com), running locally, with the model pulled:

  ```bash
  ollama pull mistral-nemo
  ```

The writing queue and daily note tasks work without Ollama. Only the AI commands need it.

### Install with BRAT (recommended)

1. Install **BRAT** from **Settings → Community plugins → Browse**.
2. Run **BRAT: Add a beta plugin for testing** from the command palette.
3. Paste this repository's GitHub URL and select **Add plugin**.
4. Turn on **Incremental Writing with Ollama** under **Settings → Community plugins**.

BRAT also keeps the plugin up to date when new releases are published.

### Install manually

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [release](../../releases).
2. Create the folder `<your vault>/.obsidian/plugins/incremental-writing/` and put the three files in it.
3. Reload Obsidian, then turn on the plugin under **Settings → Community plugins**.

### Check the connection

Open **Settings → Incremental Writing with Ollama** and select **Test connection**. You should see *"Ollama is reachable. Using model mistral-nemo:latest"*.

---

## Quick start

1. Open or create a note and run **Add current note to writing queue** (Ctrl/Cmd+P). The note gets these properties:

   ```yaml
   iw_status: seed
   iw_due: 2026-09-26
   iw_interval: 1
   iw_last_reviewed: 2026-09-25
   ```

   A review task is also added to the daily note for the due date.

2. Select the checklist icon in the left ribbon to open the **Writing queue**.
3. When the note is due, open it, work on it, then select **Hard**, **Good**, or **Easy**.
4. Try the AI commands by right-clicking in the editor, or from the command palette.

---

## The writing queue

### Note properties

A note is in the queue when its frontmatter has a valid `iw_status`:

| Property | Meaning |
| --- | --- |
| `iw_status` | `seed`, `draft`, or `evergreen` |
| `iw_due` | Next review date (`YYYY-MM-DD`). Notes without one count as due today. |
| `iw_interval` | Current gap between reviews, in days |
| `iw_last_reviewed` | Date of the last review |
| `iw_parent` | Link to the parent note (set on extracted child seeds) |

### Statuses

| Status | Meaning |
| --- | --- |
| **seed** | A raw idea: a sentence, fragment, or hunch |
| **draft** | Being actively developed; has structure but isn't finished |
| **evergreen** | Mature and polished; revisited only occasionally |

Change the status with the dropdown on each queue card. Status is a label for your own tracking; it doesn't change the schedule.

### Review buttons

Each card shows **Hard**, **Good**, and **Easy**, with the resulting interval (for example **Good · 4d**):

| Button | Use it when | New interval (defaults) |
| --- | --- | --- |
| **Hard** | The session was a struggle or the note needs a lot more work | interval × 1.2 (at least 1 day) |
| **Good** | Normal progress | interval × 2 (at least interval + 1) |
| **Easy** | The note is in good shape | interval × 3 (at least interval + 1) |

Selecting a button sets `iw_interval`, sets `iw_due` to today plus the new interval, and stamps `iw_last_reviewed`. Intervals never exceed the **Maximum interval** (365 days by default).

For example, a note at a 1-day interval graded **Good** each time comes back after 2, 4, 8, then 16 days. Graded **Easy**, it comes back after 3, 9, then 27 days.

### Other queue actions

- **Title** or **📄**: open the note. Ctrl/Cmd-click the title to open it in a new tab.
- **✕**: remove the note from the queue. This deletes the `iw_status`, `iw_due`, `iw_interval`, and `iw_last_reviewed` properties and the note's open review task. The note itself and its `iw_parent` link are kept.
- **Upcoming**: notes due within the next 7 days (configurable) are listed below the due list.

---

## Daily note tasks

Whenever the plugin schedules a note, it adds a task to the daily note for the due date:

```markdown
## Tasks
- [ ] Review [[My essay]] #iw-review 📅 2026-09-29
```

- **Where**: the daily note's folder, filename format, and template come from Obsidian's core **Settings → Daily notes**. If that day's note doesn't exist yet, it's created from your template. `{{date}}`, `{{date:FORMAT}}`, `{{date+1d:FORMAT}}`, `{{time}}`, `{{title}}`, `{{yesterday}}`, and `{{tomorrow}}` are filled in for that date.
- **Placement**: the task goes at the end of the **Tasks** section (configurable). An empty `- [ ]` placeholder in that section is filled instead. If the section is missing, it's added at the end of the note.
- **Reviews**: grading a note ticks off its old task (`- [x] … ✅ date`) and adds a new one to the next due date's daily note.
- **Removing**: removing a note from the queue deletes its open task. Completed tasks are kept as history.
- **No duplicates**: running the same step twice doesn't add a second task.
- **Tasks plugin**: the `📅` date uses the Tasks plugin's emoji format. To list every open review:

  ````markdown
  ```tasks
  not done
  tags include #iw-review
  ```
  ````

Tasks are added when the plugin itself schedules a note: a review button, **Add current note to writing queue**, or **Extract tangent to child seed**. If you edit `iw_due` by hand, run **Add review tasks to daily notes for all queued notes** to catch up. Overdue notes get their task in today's daily note.

---

## AI commands

Run these from the command palette or the editor's right-click menu.

While Ollama is working, a pulsing marker shows where the result will go. You can keep typing; the marker moves with your edits. The result is inserted as a single change (Ctrl/Cmd+Z undoes it) and never overwrites your text. If you close the note before the reply arrives, the result is copied to the clipboard.

Results that go in `%% … %%` comments are hidden in Reading view. Use Source mode or Live Preview to see them.

### Socratic adversary

Critiques the selection, or the whole note if nothing is selected (frontmatter excluded), for logical gaps, weak evidence, and counterarguments, and ends with probing questions. The critique is inserted below the selection, or at the end of the note:

```markdown
%% AI Critique:
**Logical gaps:**
- …
%%
```

### Bridge draft gaps

Select **exactly two** paragraphs, or two lines or bullet points. The command writes 2–3 alternative transition sentences and inserts them between the two passages:

- **Comment block** (default): all options go in a `%% AI Bridge options %%` comment for you to choose from.
- **Visible text**: the first option is inserted as prose (or as a bullet, for lists), and the others go in a comment.

### Seed to outline scaffold

Select a fragment, or place the cursor on a line. The command expands it into a four-tier rhetorical skeleton below the seed, which is kept:

```markdown
## Title

### I. Premise: …
- Point
	- %% TODO: what to research or write %%

### II. Grounds: …
### III. Tension: …
### IV. Resolution: …
```

### Extract tangent to child seed

Select a passage that drifts off topic and run the command. Confirm or edit the suggested title, then:

1. A new note is created containing the passage, with `iw_status: seed`, scheduling properties, and `iw_parent: "[[Parent note]]"`.
2. The selection is replaced with an embed, `![[New note]]`, so the text still shows in place.
3. The child note joins the queue, and a review task is added to its daily note.

Child notes are created in the parent's folder unless you set a **Child note folder**.

---

## All commands

| Command | Needs |
| --- | --- |
| Socratic adversary: critique draft or selection | An open note |
| Bridge draft gaps between two passages | A selection |
| Seed to outline scaffold | A selection, or the cursor on a line |
| Extract tangent to child seed | A selection |
| Open writing queue | — |
| Add current note to writing queue | An open note |
| Remove current note from writing queue | An open, queued note |
| Add review tasks to daily notes for all queued notes | — |

---

## Settings

### Ollama

| Setting | Default | Notes |
| --- | --- | --- |
| Host URL | `http://127.0.0.1:11434` | Requests go to `<host>/api/chat` |
| Model | `mistral-nemo` | Matches tagged names such as `mistral-nemo:latest` |
| Fallback model | *(empty)* | Used when the main model isn't installed |
| Temperature | 0.4 | Lower is more focused, higher is more creative |
| Request timeout | 180 s | |
| Test connection | — | Checks the server and the model |

### Scheduling

| Setting | Default |
| --- | --- |
| Initial interval | 1 day |
| Maximum interval | 365 days |
| Hard / Good / Easy multipliers | 1.2 / 2.0 / 3.0 |
| Upcoming window | 7 days (0 hides it) |

### Daily note tasks

| Setting | Default |
| --- | --- |
| Add review tasks to daily notes | On |
| Tasks heading | `Tasks` |

### Editing

| Setting | Default |
| --- | --- |
| Child note folder | *(the parent's folder)* |
| Bridge insertion | Comment block |

### Prompt templates

Edit the system prompt and the prompt for each AI command. Each has a **Restore default** button.

| Placeholder | Filled with |
| --- | --- |
| `{{title}}` | The note's title |
| `{{text}}` | The selection or draft |
| `{{before}}`, `{{after}}` | The two passages (bridge only) |

The bridge and outline commands expect JSON back. If you edit their prompts, keep the JSON instruction from the default.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| *"Cannot reach Ollama…"* | Start Ollama with `ollama serve`, and check the host URL in settings |
| *"Model … is not installed"* | Run `ollama pull mistral-nemo`, or set a fallback model |
| HTTP 403 from Ollama | Allow Obsidian's origin: set `OLLAMA_ORIGINS=app://obsidian.md*` and restart Ollama |
| First AI command is slow | The model is loading into memory; later requests are faster |
| Commands missing from the palette | The bridge and extract commands only appear when text is selected |
| No task in the daily note | The note was probably queued by hand; run **Add review tasks to daily notes for all queued notes** |
| Anything else | Open the developer console (Ctrl+Shift+I) and look for lines starting with `[incremental-writing]` |

---

## Privacy

- The plugin connects only to the Ollama host you configure. By default that's `127.0.0.1`, your own computer.
- A command sends only the text it works on (the selection, the note, or the two passages) and the note's title.
- There is no telemetry, analytics, or other network access.
- Files are only changed when you run a command or select a queue button: the note itself, its frontmatter, and the daily note for its review date.

---

## Development

```bash
npm install
npm run dev        # rebuild on every change
npm run build      # type-check and production build
npm run lint
```

For live testing, keep the repository in `<vault>/.obsidian/plugins/incremental-writing/`, run `npm run dev`, and reload the plugin in Obsidian after changes.

### Project structure

```
src/
  main.ts                   Plugin lifecycle: settings, view, commands, editor extension
  settings.ts               Settings, defaults, and settings tab
  prompts.ts                Default prompt templates
  types.ts                  Frontmatter keys and shared types
  services/
    ollama.ts               Ollama client (requestUrl, model check, fallback, notices)
    scheduler.ts            Queue collection, interval maths, frontmatter updates
    dailyNotes.ts           Daily note creation and review tasks
  views/queueView.ts        Sidebar writing queue
  editor/
    pendingInsert.ts        CodeMirror 6 field that tracks pending AI insertions
    context.ts              Selection, line, and note-body resolution
  commands/
    index.ts                Command and context menu registration
    aiRunner.ts             Shared request, insert, and parse helpers
    socratic.ts             Socratic adversary
    bridge.ts               Bridge draft gaps
    outline.ts              Seed to outline scaffold
    extractTangent.ts       Extract tangent to child seed
  ui/titleModal.ts          Title prompt for extracted notes
  utils/dates.ts            Date helpers
```

### Continuous integration

- **Check** (`.github/workflows/check.yml`) lints and builds every push and pull request.
- **Release** (`.github/workflows/release.yml`) builds the plugin and publishes a GitHub release with `main.js`, `manifest.json`, and `styles.css` attached.

---

## Releasing a new version

1. Set the new version. This updates `manifest.json`, `versions.json`, and `package.json`:

   ```bash
   npm run bump -- 1.0.1
   ```

2. Commit and push, for example in GitHub Desktop: write a summary, select **Commit to main**, then **Push origin**.
3. On GitHub, open **Actions → Release → Run workflow**.

The workflow builds the plugin and publishes release `1.0.1` with the three files attached. BRAT users get the update automatically.

Alternatively, push a tag matching the version (in GitHub Desktop: **History**, right-click the commit, **Create Tag…**, then **Push origin**). The workflow runs on its own.

The release fails with a clear message if the version already has a release, or if `versions.json` has no entry for it.

---

## License

[0BSD](LICENSE) © 2026 Samarth
