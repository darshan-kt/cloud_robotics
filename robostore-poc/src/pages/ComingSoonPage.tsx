import type { ComponentType } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Chip, EmptyState } from "../components/ui/Layout";

interface ComingSoonPageProps {
  title: string;
  icon: ComponentType<{ className?: string }>;
  tag: string;
}

// Placeholder target for every deck tile whose app hasn't been built out
// yet. The deck (AppStorePage) links straight to these routes so nothing is
// ever a dead link - each one gets swapped for the real page as it's
// proposed and built, one app at a time.
//
// `iconColor` is gone from the props: tools no longer carry a decorative
// hue, so there is nothing for a caller to pass. See ui/Layout.tsx.
export function ComingSoonPage({ title, icon: Icon, tag }: ComingSoonPageProps) {
  return (
    <AppShell title={title}>
      <div className="mx-auto flex h-full max-w-3xl items-center justify-center">
        <EmptyState
          icon={<Icon className="h-9 w-9" />}
          title={`${title} hasn't been built yet`}
          description="This tile is reserved on the deck for a real app — propose what it should do and it'll be built out here."
          action={<Chip>{tag} — planned</Chip>}
        />
      </div>
    </AppShell>
  );
}
