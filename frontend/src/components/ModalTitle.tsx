import type { LucideIcon } from 'lucide-react'

interface ModalTitleProps {
  icon: LucideIcon
  title: string
}

export default function ModalTitle({ icon: Icon, title }: ModalTitleProps) {
  return (
    <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
      <Icon className="w-5 h-5 text-gray-400 shrink-0" />
      <span>{title}</span>
    </h3>
  )
}
