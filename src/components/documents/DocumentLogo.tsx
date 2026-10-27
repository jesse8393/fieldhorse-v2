import { useEffect, useState } from 'react'
import type { ImgHTMLAttributes } from 'react'
import { loadLogoForPdf } from '../../lib/pdfLogo.ts'

/** Share the same alpha-aware logo treatment as downloaded documents. */
export function useDocumentLogo(src?: string | null) {
  const [resolved, setResolved] = useState<{ source: string; url: string } | null>(null)
  useEffect(() => {
    if (!src) return
    let active = true
    void loadLogoForPdf(src).then((logo) => {
      if (active && logo) setResolved({ source: src, url: logo.dataUrl })
    })
    return () => { active = false }
  }, [src])
  return resolved && resolved.source === src ? resolved.url : src || undefined
}

export default function DocumentLogo({ src, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const displaySrc = useDocumentLogo(src)
  return <img {...props} src={displaySrc} />
}
