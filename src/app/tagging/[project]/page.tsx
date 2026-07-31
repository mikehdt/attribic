import { redirect } from 'next/navigation';

/**
 * A project URL with no page number is a first-page request. Existence isn't
 * checked here — a folder that isn't there fails through the asset load on the
 * paged route the same way any other bad slug does.
 */
export default async function TaggingProjectRedirect({
  params,
}: {
  params: Promise<{ project: string }>;
}) {
  const { project } = await params;
  redirect(`/tagging/${encodeURIComponent(project)}/1`);
}
