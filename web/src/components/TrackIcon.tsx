import type { IconType } from "react-icons";
import {
  LuActivity, LuBot, LuBrainCircuit, LuContainer, LuDatabase, LuFlaskConical, LuGitBranch, LuHammer,
  LuKanban, LuLayers, LuNetwork, LuRadio, LuSend, LuShip, LuTelescope, LuWind, LuWorkflow, LuZap,
} from "react-icons/lu";

/** Generic glyphs per track (not product logos, which are trademarks). */
const ICONS: Record<string, IconType> = {
  "git-github": LuGitBranch,
  docker: LuContainer,
  kubernetes: LuShip,
  postgresql: LuDatabase,
  terraform: LuLayers,
  "github-actions": LuWorkflow,
  "prometheus-grafana": LuActivity,
  "langchain-llamaindex": LuBrainCircuit,
  redis: LuZap,
  kafka: LuRadio,
  jenkins: LuHammer,
  jira: LuKanban,
  postman: LuSend,
  nginx: LuNetwork,
  opentelemetry: LuTelescope,
  airflow: LuWind,
  n8n: LuBot,
  mlflow: LuFlaskConical,
};

export function TrackIcon({ slug, size = 20 }: { slug: string; size?: number }) {
  const Icon = ICONS[slug] ?? LuLayers;
  return <Icon size={size} aria-hidden="true" focusable="false" />;
}
