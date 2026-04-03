# ObsidianPlaginMdToHTML

Obsidian plugin that checks notes for underscore-based markdown formatting and converts it to HTML tags.

## What it does

- scans the active note or the whole vault for underscore-based markdown formatting
- shows an issue badge near notes in the File Explorer when formatting is found
- adds actions to the note right-click menu in the File Explorer
- adds a report panel with all problematic files and quick actions
- skips fenced code blocks
- skips inline code fragments wrapped in backticks
- converts `_text_` to `<i>text</i>`
- converts `*text*` to `<i>text</i>`
- converts `**text**` to `<b>text</b>`
- works in the current note or across the whole vault

## Commands

- `Scan current note for underscore italics and bold`
- `Convert underscore italics and bold in current note to HTML`
- `Scan all notes in vault for underscore italics and bold`
- `Convert underscore italics and bold to HTML in all notes`

## File Explorer integration

- notes with matching markdown formatting get a badge with the number of issues
- right click a note to scan it or convert it
- right click multiple selected notes to scan or convert them in batch

## Report view

- open `Open markdown formatting report` from the command palette
- or click the new ribbon icon in the left sidebar
- review all files with issues in one panel
- open a file or convert it directly from the report

## Development

```bash
npm install
npm run build
```

Then copy `manifest.json`, `main.js`, and `styles.css` into:

```text
<your-vault>/.obsidian/plugins/obsidian-plugin-md-to-html/
```

Enable the plugin in Obsidian Community Plugins.
