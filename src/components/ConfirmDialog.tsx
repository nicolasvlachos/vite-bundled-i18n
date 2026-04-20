import { useI18n } from '../react/useI18n'

interface ConfirmDialogProps {
  message: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  const { t } = useI18n()

  return (
    <div style={{ border: '1px solid #e5e4e7', borderRadius: 8, padding: 16, background: '#fafafa' }}>
      <p>{message}</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel}>{t('shared.cancel', 'Cancel')}</button>
        <button onClick={onConfirm}>{t('shared.confirm', 'Confirm')}</button>
      </div>
    </div>
  )
}
