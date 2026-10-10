// Redesign component library (spec section 7). Styles live in
// src/styles/fh-components.css under the fhc- prefix and read only the
// --fh- tokens, so every component follows Day and Night on its own.
//
// Monogram, Dock and ThemeModeControl live beside these but are owned by
// the app shell work; import them from their own files.

export { default as Icon } from './Icon.tsx'
export type { IconSize } from './Icon.tsx'

export { default as Button } from './Button.tsx'
export type {
  ButtonProps,
  ButtonOwnProps,
  ButtonAsButtonProps,
  ButtonAsLinkProps,
  ButtonAsAnchorProps,
  ButtonVariant,
  ButtonSize
} from './Button.tsx'

export { default as IconButton } from './IconButton.tsx'
export type {
  IconButtonProps,
  IconButtonOwnProps,
  IconButtonAsButtonProps,
  IconButtonAsLinkProps,
  IconButtonVariant,
  IconButtonShape,
  IconButtonSize
} from './IconButton.tsx'

export { default as Field } from './Field.tsx'
export type { FieldProps, FieldOwnProps, FieldInputProps, FieldTextareaProps } from './Field.tsx'

export { default as Chip } from './Chip.tsx'
export type { ChipProps, ChipTone } from './Chip.tsx'

export { default as SyncPill, syncPillState, useSyncInput } from './SyncPill.tsx'
export type { SyncPillProps, SyncPillInput, SyncPillState, SyncStatus } from './SyncPill.tsx'

export { default as StageRail } from './StageRail.tsx'
export type { StageRailProps } from './StageRail.tsx'

export { default as Row } from './Row.tsx'
export type { RowProps, RowOwnProps, RowLinkProps, RowButtonProps, RowStaticProps } from './Row.tsx'

export { default as SpineEntry } from './SpineEntry.tsx'
export type { SpineEntryProps, SpinePhoto } from './SpineEntry.tsx'

export { default as OnyxStage } from './OnyxStage.tsx'
export type { OnyxStageProps } from './OnyxStage.tsx'

export { default as PhotoCard } from './PhotoCard.tsx'
export type { PhotoCardProps, PhotoCardWithPhotoProps, PhotoCardWithoutPhotoProps } from './PhotoCard.tsx'

export { default as VaultCard } from './VaultCard.tsx'
export type { VaultCardProps, VaultFact } from './VaultCard.tsx'

export { default as Skeleton, SkeletonRow, SkeletonRows } from './Skeleton.tsx'
export type { SkeletonProps, SkeletonShape, SkeletonRowsProps } from './Skeleton.tsx'

export { default as EmptyState } from './EmptyState.tsx'
export type { EmptyStateProps } from './EmptyState.tsx'

export { default as KeyCap } from './KeyCap.tsx'
export type { KeyCapProps } from './KeyCap.tsx'

export { default as Sheet, useSheet } from './Sheet.tsx'
export type { SheetProps, SheetDiscardCopy } from './Sheet.tsx'

export { formatMoney } from './money.ts'
