/**
 * Build the URL for a project's thumbnail.
 *
 * Thumbnails live at `<project>/.tagging/project.png` inside the projects
 * folder, which is outside `/public` and so can't be served statically. The
 * existing image route already resolves arbitrary paths under the projects
 * root with a containment check, so it serves these too.
 *
 * It sets a one-year immutable cache header, so `version` is what makes a
 * re-uploaded thumbnail actually appear.
 */
export const projectThumbnailSrc = (
  projectName: string,
  version?: number,
): string =>
  `/api/images/.tagging/project.png?projectName=${encodeURIComponent(projectName)}${
    version ? `&v=${version}` : ''
  }`;
