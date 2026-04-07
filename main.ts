import {
  MarkdownView,
  ItemView,
  Menu,
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";

type MatchInfo = {
  count: number;
  value: string;
};

type IssueType = "markdown" | "quotes";

type MatchLocation = {
  from: { line: number; ch: number };
  to: { line: number; ch: number };
};

const INLINE_CODE_PATTERN = /(`[^`]*`)/g;
const BOLD_PATTERN = /(^|[^\\*])\*\*([^*\n]+?)\*\*(?=($|[^\\*]))/g;
const ASTERISK_ITALIC_PATTERN = /(^|[^\\*])\*([^*\n]+?)\*(?=($|[^\\*]))/g;
const UNDERSCORE_ITALIC_PATTERN = /(^|[^\\\w])_([^_\n]+?)_(?=($|[^\w]))/g;
const QUOTE_PATTERN = /(^|[^\\"])"([^"\n]+?)"(?=($|[^\\"]))/g;
const BADGE_CLASS = "md-to-html-issue-badge";
const REPORT_VIEW_TYPE = "md-to-html-report-view";
const MARKDOWN_MATCHERS = [BOLD_PATTERN, ASTERISK_ITALIC_PATTERN, UNDERSCORE_ITALIC_PATTERN];
const QUOTE_MATCHERS = [QUOTE_PATTERN];

function convertMarkdownSegment(segment: string): MatchInfo {
  let count = 0;

  const boldConverted = segment.replace(
    BOLD_PATTERN,
    (fullMatch, prefix: string, content: string) => {
      count += 1;
      return `${prefix}<b>${content}</b>`;
    },
  );

  const asteriskItalicConverted = boldConverted.replace(
    ASTERISK_ITALIC_PATTERN,
    (fullMatch, prefix: string, content: string) => {
      count += 1;
      return `${prefix}<i>${content}</i>`;
    },
  );

  const value = asteriskItalicConverted.replace(
    UNDERSCORE_ITALIC_PATTERN,
    (fullMatch, prefix: string, content: string) => {
      count += 1;
      return `${prefix}<i>${content}</i>`;
    },
  );

  return { count, value };
}

function convertQuoteSegment(segment: string): MatchInfo {
  let count = 0;

  const value = segment.replace(
    QUOTE_PATTERN,
    (fullMatch, prefix: string, content: string) => {
      count += 1;
      return `${prefix}«${content}»`;
    },
  );

  return { count, value };
}

function transformText(
  text: string,
  segmentTransformer: (segment: string) => MatchInfo,
): MatchInfo {
  const lines = text.split("\n");
  let insideFence = false;
  let totalCount = 0;

  const convertedLines = lines.map((line) => {
    if (/^\s*```/.test(line)) {
      insideFence = !insideFence;
      return line;
    }

    if (insideFence) {
      return line;
    }

    const parts = line.split(INLINE_CODE_PATTERN);
    const convertedParts = parts.map((part) => {
      if (part.startsWith("`") && part.endsWith("`")) {
        return part;
      }

      const result = segmentTransformer(part);
      totalCount += result.count;
      return result.value;
    });

    return convertedParts.join("");
  });

  return {
    count: totalCount,
    value: convertedLines.join("\n"),
  };
}

function convertMarkdownFormatting(text: string): MatchInfo {
  return transformText(text, convertMarkdownSegment);
}

function convertStraightQuotes(text: string): MatchInfo {
  return transformText(text, convertQuoteSegment);
}

function findFirstMatchLocation(text: string, matchers: RegExp[]): MatchLocation | null {
  const lines = text.split("\n");
  let insideFence = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];

    if (/^\s*```/.test(line)) {
      insideFence = !insideFence;
      continue;
    }

    if (insideFence) {
      continue;
    }

    let cursor = 0;
    const parts = line.split(INLINE_CODE_PATTERN);

    for (const part of parts) {
      const partStart = cursor;
      cursor += part.length;

      if (part.startsWith("`") && part.endsWith("`")) {
        continue;
      }

      const matches = matchers
        .map((matcher) => {
          matcher.lastIndex = 0;
          const match = matcher.exec(part);

          if (!match || match.index === undefined) {
            return null;
          }

          return { matcher, match };
        })
        .filter((entry): entry is { matcher: RegExp; match: RegExpExecArray } => entry !== null)
        .sort((left, right) => left.match.index - right.match.index);

      const firstMatch = matches[0];

      if (firstMatch) {
        const prefix = firstMatch.match[1] ?? "";
        const content = firstMatch.match[2] ?? "";
        const startCh = partStart + firstMatch.match.index + prefix.length;
        const wrapperLength = firstMatch.matcher === BOLD_PATTERN ? 4 : 2;
        const endCh = startCh + content.length + wrapperLength;

        return {
          from: { line: lineIndex, ch: startCh },
          to: { line: lineIndex, ch: endCh },
        };
      }
    }
  }

  return null;
}

class MdToHtmlReportView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: MdToHtmlItalicsCheckerPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return REPORT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Markdown HTML Report";
  }

  getIcon(): string {
    return "clipboard-list";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("md-to-html-report-view");

    const header = contentEl.createDiv({ cls: "md-to-html-report-header" });
    header.createEl("h3", { text: "Markdown Formatting Report" });

    const refreshButton = header.createEl("button", {
      text: "Refresh",
      cls: "mod-cta",
    });
    refreshButton.addEventListener("click", () => {
      void this.plugin.refreshReport();
    });

    const actions = contentEl.createDiv({ cls: "md-to-html-report-actions" });

    const scanButton = actions.createEl("button", {
      text: "Scan vault",
    });
    scanButton.addEventListener("click", () => {
      void this.plugin.scanVault();
    });

    const convertButton = actions.createEl("button", {
      text: "Convert all",
      cls: "mod-warning",
    });
    convertButton.addEventListener("click", () => {
      void this.plugin.convertVault();
    });

    const items = this.plugin.getProblemFiles();

    if (items.length === 0) {
      contentEl.createDiv({
        text: "No files with markdown formatting issues were found.",
        cls: "md-to-html-report-empty",
      });
      return;
    }

    const list = contentEl.createDiv({ cls: "md-to-html-report-list" });

    for (const item of items) {
      const row = list.createDiv({ cls: "md-to-html-report-row" });

      const info = row.createDiv({ cls: "md-to-html-report-info" });
      info.createDiv({
        text: item.file.basename,
        cls: "md-to-html-report-title",
      });
      info.createDiv({
        text: `${item.count} issue(s) - ${item.file.path}`,
        cls: "md-to-html-report-meta",
      });

      const openButton = row.createEl("button", { text: "Open" });
      openButton.addEventListener("click", () => {
        void this.plugin.openFile(item.file);
      });

      const convertOneButton = row.createEl("button", {
        text: "Convert",
        cls: "mod-warning",
      });
      convertOneButton.addEventListener("click", () => {
        void this.plugin.convertFile(item.file);
      });
    }
  }
}

export default class MdToHtmlItalicsCheckerPlugin extends Plugin {
  private markdownIssueCounts = new Map<string, number>();
  private quoteIssueCounts = new Map<string, number>();

  async onload(): Promise<void> {
    this.registerView(
      REPORT_VIEW_TYPE,
      (leaf) => new MdToHtmlReportView(leaf, this),
    );

    this.addRibbonIcon("clipboard-list", "Open markdown formatting report", () => {
      void this.activateReportView();
    });

    this.addCommand({
      id: "open-markdown-formatting-report",
      name: "Open markdown formatting report",
      callback: () => {
        void this.activateReportView();
      },
    });

    this.addCommand({
      id: "scan-current-note-markdown-formatting",
      name: "Scan current note for markdown italics and bold",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();

        if (!this.isMarkdownFile(file)) {
          return false;
        }

        if (!checking) {
          void this.scanFile(file);
        }

        return true;
      },
    });

    this.addCommand({
      id: "convert-current-note-markdown-formatting-to-html",
      name: "Convert markdown italics and bold in current note to HTML",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();

        if (!this.isMarkdownFile(file)) {
          return false;
        }

        if (!checking) {
          void this.convertFile(file);
        }

        return true;
      },
    });

    this.addCommand({
      id: "scan-vault-markdown-formatting",
      name: "Scan all notes in vault for markdown italics and bold",
      callback: () => {
        void this.scanVault();
      },
    });

    this.addCommand({
      id: "convert-vault-markdown-formatting-to-html",
      name: "Convert markdown italics and bold to HTML in all notes",
      callback: () => {
        void this.convertVault();
      },
    });

    this.addCommand({
      id: "scan-current-note-straight-quotes",
      name: "Scan current note for straight quotes",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();

        if (!this.isMarkdownFile(file)) {
          return false;
        }

        if (!checking) {
          void this.scanQuotesInFile(file);
        }

        return true;
      },
    });

    this.addCommand({
      id: "convert-current-note-straight-quotes",
      name: "Convert straight quotes in current note to guillemets",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();

        if (!this.isMarkdownFile(file)) {
          return false;
        }

        if (!checking) {
          void this.convertQuotesInFile(file);
        }

        return true;
      },
    });

    this.addCommand({
      id: "scan-vault-straight-quotes",
      name: "Scan all notes in vault for straight quotes",
      callback: () => {
        void this.scanQuotesInVault();
      },
    });

    this.addCommand({
      id: "convert-vault-straight-quotes",
      name: "Convert straight quotes to guillemets in all notes",
      callback: () => {
        void this.convertQuotesInVault();
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        this.addFileMenuItems(menu, file);
      }),
    );

    this.registerEvent(
      this.app.workspace.on("files-menu", (menu, files) => {
        this.addFilesMenuItems(menu, files);
      }),
    );

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (this.isMarkdownFile(file)) {
          void this.refreshFileIssueState(file);
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (this.isMarkdownFile(file)) {
          void this.refreshFileIssueState(file);
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.markdownIssueCounts.delete(oldPath);
        this.quoteIssueCounts.delete(oldPath);

        if (this.isMarkdownFile(file)) {
          void this.refreshFileIssueState(file);
          return;
        }

        this.refreshUi();
      }),
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        this.markdownIssueCounts.delete(file.path);
        this.quoteIssueCounts.delete(file.path);
        this.refreshUi();
      }),
    );

    this.app.workspace.onLayoutReady(() => {
      void this.initializeExplorerIndicators();
    });
  }

  async onunload(): Promise<void> {
    await this.detachLeavesOfType(REPORT_VIEW_TYPE);
  }

  getProblemFiles(): Array<{ file: TFile; count: number }> {
    return this.app.vault
      .getMarkdownFiles()
      .map((file) => ({
        file,
        count: (this.markdownIssueCounts.get(file.path) ?? 0) + (this.quoteIssueCounts.get(file.path) ?? 0),
      }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count || a.file.path.localeCompare(b.file.path));
  }

  async openFile(file: TFile): Promise<void> {
    await this.openFileAtFirstIssue(file);
  }

  async refreshReport(): Promise<void> {
    await this.rebuildIssueCache();
    this.refreshUi();
  }

  async scanVault(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    await this.scanFiles(files);
  }

  async convertVault(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    await this.convertFiles(files);
  }

  async scanQuotesInVault(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    await this.scanQuoteFiles(files);
  }

  async convertQuotesInVault(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    await this.convertQuoteFiles(files);
  }

  async convertFile(file: TFile): Promise<void> {
    const content = await this.app.vault.read(file);
    const result = convertMarkdownFormatting(content);

    if (result.count === 0) {
      this.markdownIssueCounts.set(file.path, 0);
      this.refreshUi();
      new Notice("Nothing to convert in the current note.");
      return;
    }

    await this.app.vault.modify(file, result.value);
    this.markdownIssueCounts.set(file.path, 0);
    const quotesResult = convertStraightQuotes(result.value);
    this.quoteIssueCounts.set(file.path, quotesResult.count);
    this.refreshUi();
    new Notice(`Converted ${result.count} markdown formatting fragment(s) to HTML tags.`);
  }

  async convertQuotesInFile(file: TFile): Promise<void> {
    const content = await this.app.vault.read(file);
    const result = convertStraightQuotes(content);

    if (result.count === 0) {
      this.quoteIssueCounts.set(file.path, 0);
      this.refreshUi();
      new Notice("No straight quotes to convert in the current note.");
      return;
    }

    await this.app.vault.modify(file, result.value);
    this.quoteIssueCounts.set(file.path, 0);
    const markdownResult = convertMarkdownFormatting(result.value);
    this.markdownIssueCounts.set(file.path, markdownResult.count);
    this.refreshUi();
    new Notice(`Converted ${result.count} straight quote fragment(s) to guillemets.`);
  }

  async openFileAtFirstIssue(file: TFile, issueType: IssueType = "markdown"): Promise<void> {
    const content = await this.app.vault.read(file);
    const matchLocation = findFirstMatchLocation(
      content,
      issueType === "markdown" ? MARKDOWN_MATCHERS : QUOTE_MATCHERS,
    );
    const leaf = this.app.workspace.getLeaf(true);

    await leaf.openFile(file);
    await this.app.workspace.revealLeaf(leaf);

    if (!matchLocation) {
      return;
    }

    const view = leaf.view;

    if (!(view instanceof MarkdownView)) {
      return;
    }

    const { editor } = view;
    editor.setSelection(matchLocation.from, matchLocation.to);
    editor.setCursor(matchLocation.from);
    editor.scrollIntoView(
      {
        from: matchLocation.from,
        to: matchLocation.to,
      },
      true,
    );
  }

  private isMarkdownFile(file: TAbstractFile | null): file is TFile {
    return file instanceof TFile && file.extension === "md";
  }

  private async initializeExplorerIndicators(): Promise<void> {
    await this.refreshVisibleExplorerFiles();
    this.refreshExplorerBadges();

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        void this.refreshVisibleExplorerFiles();
      }),
    );
  }

  private addFileMenuItems(menu: Menu, file: TAbstractFile): void {
    if (!this.isMarkdownFile(file)) {
      return;
    }

    menu.addItem((item) => {
      item
        .setTitle("Scan markdown formatting for HTML conversion")
        .setIcon("search")
        .setSection("md-to-html")
        .onClick(() => {
          void this.scanFile(file);
        });
    });

    menu.addItem((item) => {
      item
        .setTitle("Convert markdown formatting to HTML")
        .setIcon("wand-sparkles")
        .setSection("md-to-html")
        .onClick(() => {
          void this.convertFile(file);
        });
    });

    menu.addItem((item) => {
      item
        .setTitle("Scan straight quotes")
        .setIcon("search")
        .setSection("md-to-html-quotes")
        .onClick(() => {
          void this.scanQuotesInFile(file);
        });
    });

    menu.addItem((item) => {
      item
        .setTitle("Convert straight quotes to guillemets")
        .setIcon("quote-glyph")
        .setSection("md-to-html-quotes")
        .onClick(() => {
          void this.convertQuotesInFile(file);
        });
    });
  }

  private addFilesMenuItems(menu: Menu, files: TAbstractFile[]): void {
    const markdownFiles = files.filter((file): file is TFile => this.isMarkdownFile(file));

    if (markdownFiles.length === 0) {
      return;
    }

    menu.addItem((item) => {
      item
        .setTitle("Scan markdown formatting in selected notes")
        .setIcon("search")
        .setSection("md-to-html")
        .onClick(() => {
          void this.scanFiles(markdownFiles);
        });
    });

    menu.addItem((item) => {
      item
        .setTitle("Convert markdown formatting to HTML in selected notes")
        .setIcon("wand-sparkles")
        .setSection("md-to-html")
        .onClick(() => {
          void this.convertFiles(markdownFiles);
        });
    });

    menu.addItem((item) => {
      item
        .setTitle("Scan straight quotes in selected notes")
        .setIcon("search")
        .setSection("md-to-html-quotes")
        .onClick(() => {
          void this.scanQuoteFiles(markdownFiles);
        });
    });

    menu.addItem((item) => {
      item
        .setTitle("Convert straight quotes to guillemets in selected notes")
        .setIcon("quote-glyph")
        .setSection("md-to-html-quotes")
        .onClick(() => {
          void this.convertQuoteFiles(markdownFiles);
        });
    });
  }

  private async analyzeMarkdownFile(file: TFile): Promise<MatchInfo> {
    const content = await this.app.vault.read(file);
    return convertMarkdownFormatting(content);
  }

  private async analyzeQuoteFile(file: TFile): Promise<MatchInfo> {
    const content = await this.app.vault.read(file);
    return convertStraightQuotes(content);
  }

  private async scanFile(file: TFile): Promise<void> {
    const result = await this.analyzeMarkdownFile(file);
    this.markdownIssueCounts.set(file.path, result.count);
    this.refreshUi();

    if (result.count === 0) {
      new Notice("No markdown italics or bold fragments found in the current note.");
      return;
    }

    new Notice(`Found ${result.count} markdown formatting fragment(s) in the current note.`);
  }

  private async scanFiles(files: TFile[]): Promise<void> {
    let affectedFiles = 0;
    let totalMatches = 0;

    for (const file of files) {
      const result = await this.analyzeMarkdownFile(file);
      this.markdownIssueCounts.set(file.path, result.count);

      if (result.count > 0) {
        affectedFiles += 1;
        totalMatches += result.count;
      }
    }

    this.refreshUi();

    if (totalMatches === 0) {
      new Notice("No markdown italics or bold fragments found in selected notes.");
      return;
    }

    new Notice(`Found ${totalMatches} issue(s) in ${affectedFiles} selected note(s).`, 8000);
  }

  private async convertFiles(files: TFile[]): Promise<void> {
    let changedFiles = 0;
    let totalMatches = 0;

    for (const file of files) {
      const content = await this.app.vault.read(file);
      const result = convertMarkdownFormatting(content);

      if (result.count === 0) {
        this.markdownIssueCounts.set(file.path, 0);
        continue;
      }

      await this.app.vault.modify(file, result.value);
      this.markdownIssueCounts.set(file.path, 0);
      const quotesResult = convertStraightQuotes(result.value);
      this.quoteIssueCounts.set(file.path, quotesResult.count);
      changedFiles += 1;
      totalMatches += result.count;
    }

    this.refreshUi();

    if (totalMatches === 0) {
      new Notice("Nothing to convert in selected notes.");
      return;
    }

    new Notice(`Converted ${totalMatches} fragment(s) in ${changedFiles} selected note(s).`, 8000);
  }

  private async scanQuotesInFile(file: TFile): Promise<void> {
    const result = await this.analyzeQuoteFile(file);
    this.quoteIssueCounts.set(file.path, result.count);
    this.refreshUi();

    if (result.count === 0) {
      new Notice("No straight quotes found in the current note.");
      return;
    }

    new Notice(`Found ${result.count} straight quote fragment(s) in the current note.`);
  }

  private async scanQuoteFiles(files: TFile[]): Promise<void> {
    let affectedFiles = 0;
    let totalMatches = 0;

    for (const file of files) {
      const result = await this.analyzeQuoteFile(file);
      this.quoteIssueCounts.set(file.path, result.count);

      if (result.count > 0) {
        affectedFiles += 1;
        totalMatches += result.count;
      }
    }

    this.refreshUi();

    if (totalMatches === 0) {
      new Notice("No straight quotes found in selected notes.");
      return;
    }

    new Notice(`Found ${totalMatches} straight quote issue(s) in ${affectedFiles} selected note(s).`, 8000);
  }

  private async convertQuoteFiles(files: TFile[]): Promise<void> {
    let changedFiles = 0;
    let totalMatches = 0;

    for (const file of files) {
      const content = await this.app.vault.read(file);
      const result = convertStraightQuotes(content);

      if (result.count === 0) {
        this.quoteIssueCounts.set(file.path, 0);
        continue;
      }

      await this.app.vault.modify(file, result.value);
      this.quoteIssueCounts.set(file.path, 0);
      const markdownResult = convertMarkdownFormatting(result.value);
      this.markdownIssueCounts.set(file.path, markdownResult.count);
      changedFiles += 1;
      totalMatches += result.count;
    }

    this.refreshUi();

    if (totalMatches === 0) {
      new Notice("No straight quotes to convert in selected notes.");
      return;
    }

    new Notice(`Converted ${totalMatches} straight quote fragment(s) in ${changedFiles} selected note(s).`, 8000);
  }

  private async rebuildIssueCache(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      const markdownResult = await this.analyzeMarkdownFile(file);
      const quoteResult = await this.analyzeQuoteFile(file);
      this.markdownIssueCounts.set(file.path, markdownResult.count);
      this.quoteIssueCounts.set(file.path, quoteResult.count);
    }
  }

  private async refreshVisibleExplorerFiles(): Promise<void> {
    const elements = document.querySelectorAll<HTMLElement>(".nav-file-title[data-path]");
    const paths = new Set<string>();

    for (const element of elements) {
      const path = element.dataset.path;

      if (path) {
        paths.add(path);
      }
    }

    for (const path of paths) {
      if (this.markdownIssueCounts.has(path) && this.quoteIssueCounts.has(path)) {
        continue;
      }

      const file = this.app.vault.getAbstractFileByPath(path);

      if (!this.isMarkdownFile(file)) {
        continue;
      }

      const markdownResult = await this.analyzeMarkdownFile(file);
      const quoteResult = await this.analyzeQuoteFile(file);
      this.markdownIssueCounts.set(file.path, markdownResult.count);
      this.quoteIssueCounts.set(file.path, quoteResult.count);
    }

    this.refreshExplorerBadges();
  }

  private async refreshFileIssueState(file: TFile): Promise<void> {
    const markdownResult = await this.analyzeMarkdownFile(file);
    const quoteResult = await this.analyzeQuoteFile(file);
    this.markdownIssueCounts.set(file.path, markdownResult.count);
    this.quoteIssueCounts.set(file.path, quoteResult.count);
    this.refreshUi();
  }

  private refreshUi(): void {
    this.refreshExplorerBadges();
    this.refreshOpenReportViews();
  }

  private refreshExplorerBadges(): void {
    const elements = document.querySelectorAll<HTMLElement>(".nav-file-title[data-path]");

    for (const element of elements) {
      const path = element.dataset.path;

      if (!path) {
        continue;
      }

      const markdownCount = this.markdownIssueCounts.get(path) ?? 0;
      const quoteCount = this.quoteIssueCounts.get(path) ?? 0;

      this.renderExplorerBadge(element, path, "markdown", markdownCount);
      this.renderExplorerBadge(element, path, "quotes", quoteCount);
    }
  }

  private renderExplorerBadge(
    element: HTMLElement,
    path: string,
    issueType: IssueType,
    count: number,
  ): void {
    const badgeSelector = `.${BADGE_CLASS}[data-issue-type="${issueType}"]`;
    const existingBadge = element.querySelector<HTMLElement>(badgeSelector);

    if (count <= 0) {
      existingBadge?.remove();
      return;
    }

    if (existingBadge) {
      existingBadge.setAttribute("aria-label", `${count} ${issueType} issues`);
      existingBadge.title =
        issueType === "markdown"
          ? `${count} markdown formatting issue(s)`
          : `${count} straight quote issue(s)`;
      existingBadge.lastChild?.remove();
      existingBadge.append(String(count));
      return;
    }

    const badge = document.createElement("span");
    badge.className = `${BADGE_CLASS} ${BADGE_CLASS}--${issueType}`;
    badge.dataset.issueType = issueType;
    badge.setAttribute("aria-label", `${count} ${issueType} issues`);
    badge.title =
      issueType === "markdown"
        ? `${count} markdown formatting issue(s)`
        : `${count} straight quote issue(s)`;
    badge.setAttribute("role", "button");
    badge.tabIndex = 0;
    badge.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const file = this.app.vault.getAbstractFileByPath(path);

      if (this.isMarkdownFile(file)) {
        void this.openFileAtFirstIssue(file, issueType);
      }
    });
    badge.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const file = this.app.vault.getAbstractFileByPath(path);

      if (this.isMarkdownFile(file)) {
        void this.openFileAtFirstIssue(file, issueType);
      }
    });

    const iconWrapper = document.createElement("span");
    iconWrapper.className = `${BADGE_CLASS}-icon`;
    setIcon(iconWrapper, issueType === "markdown" ? "alert-circle" : "quote-glyph");
    badge.appendChild(iconWrapper);
    badge.append(String(count));

    element.appendChild(badge);
  }

  private refreshOpenReportViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(REPORT_VIEW_TYPE);

    for (const leaf of leaves) {
      const view = leaf.view;

      if (view instanceof MdToHtmlReportView) {
        view.render();
      }
    }
  }

  private async activateReportView(): Promise<void> {
    const existingLeaf = this.app.workspace.getLeavesOfType(REPORT_VIEW_TYPE)[0];
    const leaf = existingLeaf ?? this.app.workspace.getRightLeaf(false);

    if (!leaf) {
      return;
    }

    await leaf.setViewState({
      type: REPORT_VIEW_TYPE,
      active: true,
    });

    this.refreshOpenReportViews();
    await this.app.workspace.revealLeaf(leaf);
  }

  private async detachLeavesOfType(viewType: string): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(viewType);

    for (const leaf of leaves) {
      await leaf.setViewState({ type: "empty" });
    }
  }
}
