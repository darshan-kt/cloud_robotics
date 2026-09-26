import { SectionDeck } from "../components/layout/SectionDeck";
import { SECTIONS } from "../lib/appCatalog";

const SECTION = SECTIONS.find((s) => s.id === "ai")!;

export function AiDeckPage() {
  return <SectionDeck section={SECTION} />;
}
