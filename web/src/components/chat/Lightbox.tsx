import { useChatStore } from '../../store/chatStore'

export function Lightbox() {
  const { lightboxUrl, setLightboxUrl } = useChatStore()
  if (!lightboxUrl) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
      onClick={() => setLightboxUrl(null)}
    >
      <img src={lightboxUrl} alt="Preview" className="max-w-full max-h-full rounded-lg shadow-2xl" />
    </div>
  )
}
