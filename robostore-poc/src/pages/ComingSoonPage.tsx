import type { ComponentType } from "react";
import { Header } from "../components/layout/Header";
import { EmptyState } from "../components/ui/Layout";
import { Badge } from "../components/ui/Layout";

interface ComingSoonPageProps {
  title: string;
  icon: ComponentType<{ className?: string }>;
  iconColor: string;
  tag: string;
}

// Placeholder target for every app-store card whose app hasn't been built
// out yet. The hub (AppStorePage) links straight to these routes so nothing
// is ever a dead link - each one gets swapped for the real page as it's
// proposed and built, one app at a time.
export function ComingSoonPage({ title, icon: Icon, iconColor, tag }: ComingSoonPageProps) {
  return (
    <div className="min-h-screen">
      <Header showBack title={title} icon={Icon} iconColor={iconColor} />
      <main className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          icon={<Icon className={`h-10 w-10 ${iconColor}`} />}
          title={`${title} hasn't been built yet`}
          description="This card is reserved on the mission deck for a real app - propose what it should do and it'll be built out here."
          action={<Badge theme="muted">{tag} — planned</Badge>}
        />
      </main>
    </div>
  );
}
