// src/components/documents/photoGroups.ts
//
// Groups project photos by section tag for the proposal photo blocks
// (ProposalTemplate.tsx on screen, drawProjectPhotosBlock in src/lib/pdf.js).
//
// The photo loaders (Quote.tsx loadProjectPhotosForPdf, netlify/functions/
// public-link.js) fall back to the caption when a photo has no section_tag,
// a convention from before the column existed. Captions are now written by
// the auto captioner as full sentences, so every untagged photo became its
// own group, headed by a long uppercase sentence that ran off the PDF page.
// A tag that is only the caption is therefore read as no tag.

export const UNTAGGED_PHOTO_GROUP = 'Project photos'

type TaggedPhoto = { section_tag?: string | null; caption?: string | null }

/** The group a photo belongs to: its real section tag, or the shared bucket. */
export function photoGroupTag(photo: TaggedPhoto | null | undefined): string {
  const tag = String(photo?.section_tag || '').trim()
  if (!tag) return UNTAGGED_PHOTO_GROUP
  const caption = String(photo?.caption || '').trim()
  return caption && tag === caption ? UNTAGGED_PHOTO_GROUP : tag
}

/** Photos grouped by photoGroupTag, in first seen order. */
export function groupPhotosByTag<P extends TaggedPhoto>(photos: P[]): Map<string, P[]> {
  const groups = new Map<string, P[]>()
  for (const photo of photos) {
    const tag = photoGroupTag(photo)
    const list = groups.get(tag)
    if (list) list.push(photo)
    else groups.set(tag, [photo])
  }
  return groups
}
