// mobile/components/NewClientSheet.tsx, create a client (not a job/lead).
// Mirrors web src/components/NewClientSheet.tsx. Rendered by the Clients tab
// "+ New client" FAB.
import { useState } from 'react'
import { Text } from 'react-native'
import { useCreateClient } from '../lib/queries'
import { BottomSheet, SheetField, GoldButton, theme } from './ui'

type Props = { open: boolean; onClose: () => void; userId: string; onCreated?: (id: string) => void }

export function NewClientSheet({ open, onClose, userId, onCreated }: Props) {
  const createClient = useCreateClient()
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function reset() {
    setName(''); setCompany(''); setPhone(''); setEmail(''); setAddress(''); setErr(null)
  }

  async function submit() {
    if (!name.trim()) { setErr('A name is required.'); return }
    if (saving) return
    setSaving(true); setErr(null)
    const { id, error } = await createClient({
      userId,
      name: name.trim(),
      companyName: company.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      address: address.trim() || undefined
    })
    setSaving(false)
    if (error) { setErr(error.message); return }
    reset()
    onClose()
    if (id) onCreated?.(id)
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="New client">
      <SheetField label="Name *" value={name} onChange={setName} placeholder="Client name" autoFocus />
      <SheetField label="Company" value={company} onChange={setCompany} placeholder="Company (optional)" />
      <SheetField label="Phone" value={phone} onChange={setPhone} keyboardType="phone-pad" placeholder="(555) 555-5555" />
      <SheetField label="Email" value={email} onChange={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="name@email.com" />
      <SheetField label="Address" value={address} onChange={setAddress} placeholder="Street, city" />
      {err ? <Text style={{ color: theme.danger, fontSize: 14, marginBottom: 12 }}>{err}</Text> : null}
      <GoldButton label="Create client" onPress={submit} loading={saving} />
    </BottomSheet>
  )
}
