import { useState } from "react";
import { useI18n } from "../i18n/index.tsx";

export const connectCommand = (token: string) =>
  `claude mcp add --scope user --transport http guidepass ${window.location.origin}/mcp --header "Authorization: Bearer ${token}"`;

/**
 * Step-by-step setup of an AI agent (Claude Code) for this instance. With a
 * token it's the "just created" view; without, a reference any member can read.
 */
export function ConnectAgentGuide({ token }: { token?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState<string | null>(null);
  const command = connectCommand(token ?? "gp_…");

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
    } catch {
      // Everything stays visible to copy by hand.
    }
  }

  const CopyButton = ({ text }: { text: string }) => (
    <button type="button" className="button button-small" onClick={() => void copy(text)}>
      {copied === text ? t("tokens.copied") : t("tokens.copy")}
    </button>
  );

  return (
    <ol className="connect-steps">
      <li>
        <strong>{t("connect.step1")}</strong>
        <p className="muted">{token ? t("connect.step1Token") : t("connect.step1NoToken")}</p>
        <code className="command">{command}</code>
        {token && <CopyButton text={command} />}
      </li>
      <li>
        <strong>{t("connect.step2")}</strong>
        <p className="muted">{t("connect.step2Hint")}</p>
      </li>
      <li>
        <strong>{t("connect.step3")}</strong>
        <code className="command">claude mcp list</code>
        <p className="muted">{t("connect.step3Hint")}</p>
      </li>
      <li>
        <strong>{t("connect.step4")}</strong>
        <ul>
          {(["connect.example1", "connect.example2", "connect.example3", "connect.example4"] as const).map((key) => (
            <li key={key}>
              <q>{t(key)}</q>
            </li>
          ))}
        </ul>
      </li>
      <li>
        <strong>{t("connect.safety")}</strong>
        <p className="muted">{t("connect.safetyHint")}</p>
      </li>
    </ol>
  );
}
