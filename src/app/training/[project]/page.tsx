import { TrainingPageBody } from '../components/training-page-body';

/**
 * A saved project with no version pinned — resolves to its latest, then
 * canonicalises the URL to `/training/{slug}/v{n}`.
 */
export default function TrainingProjectPage() {
  return <TrainingPageBody />;
}
