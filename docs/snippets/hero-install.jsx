export const CopyButton = ({ text, label }) => {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      });
    }
  };
  return (
    <button type="button" className="sora-copy" onClick={onCopy} aria-label={label}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
};

export const HeroInstall = () => {
  const tabs = [
    {
      id: "install",
      label: "Install component",
      code: "npx @soralabs/cli add text-effect",
    },
    {
      id: "agent",
      label: "Agent prompt",
      code: "Set up Sora CLI for me. Fetch https://cli.soralabs.studio/for-agents.md and follow it.",
    },
    {
      id: "mcp",
      label: "AI MCP setup",
      code: "npx @soralabs/cli mcp init\n# connects to Cursor, Claude Code, VS Code, Windsurf",
    },
    {
      id: "interactive",
      label: "Interactive picker",
      code: "npx @soralabs/cli add",
    },
  ];
  const [active, setActive] = useState(0);
  const select = (i, focus) => {
    const n = (i + tabs.length) % tabs.length;
    setActive(n);
    if (focus && typeof document !== "undefined") {
      const el = document.getElementById("sora-tab-" + tabs[n].id);
      if (el) el.focus();
    }
  };
  const onKeyDown = (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); select(active + 1, true); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); select(active - 1, true); }
    else if (e.key === "Home") { e.preventDefault(); select(0, true); }
    else if (e.key === "End") { e.preventDefault(); select(tabs.length - 1, true); }
  };
  const t = tabs[active];
  return (
    <div className="sora-snippet">
      <div className="sora-snippet-bar">
        <div role="tablist" aria-label="Ways to use Sora CLI" className="sora-tablist" onKeyDown={onKeyDown}>
          {tabs.map((tab, i) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={"sora-tab-" + tab.id}
              aria-selected={i === active}
              aria-controls={"sora-panel-" + tab.id}
              tabIndex={i === active ? 0 : -1}
              className="sora-tab"
              onClick={() => select(i, false)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <CopyButton text={t.code} label={"Copy " + t.label} />
      </div>
      <div role="tabpanel" id={"sora-panel-" + t.id} aria-labelledby={"sora-tab-" + t.id} tabIndex={0} className="sora-panel">
        <pre className="sora-pre"><code>{t.code}</code></pre>
      </div>
    </div>
  );
};

export const PromptBlock = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      });
    }
  };
  return (
    <div className="sora-snippet">
      <div className="sora-snippet-bar">
        <span className="sora-snippet-title">Prompt for your coding agent</span>
        <button type="button" className="sora-copy" onClick={onCopy} aria-label="Copy prompt for your coding agent">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="sora-panel">
        <pre className="sora-pre"><code>{text}</code></pre>
      </div>
    </div>
  );
};
