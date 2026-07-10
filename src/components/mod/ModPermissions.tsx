import { CheckCircle, XCircle } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { PermissionsData } from '@/types/mod'

interface ModPermissionsProps {
  permissions: PermissionsData
}

const permissionRows: {
  key: keyof PermissionsData
  label: string
  trueText: string
  falseText: string
}[] = [
  {
    key: 'originalAssets',
    label: 'Original Assets',
    trueText: 'All assets are owned by the publisher or from free resources',
    falseText: 'Some assets may not be owned by the publisher',
  },
  {
    key: 'reupload',
    label: 'Re-upload',
    trueText: 'You may upload to other sites with credit',
    falseText: 'Do not upload to other sites without permission',
  },
  {
    key: 'modification',
    label: 'Modification',
    trueText: 'You may modify and release fixes with credit',
    falseText: 'Do not modify without permission',
  },
  {
    key: 'conversion',
    label: 'Conversion',
    trueText: 'You may convert for other games with credit',
    falseText: 'Do not convert without permission',
  },
  {
    key: 'assetUsage',
    label: 'Asset Usage',
    trueText: 'You may use assets with credit',
    falseText: 'You must get permission to use assets',
  },
  {
    key: 'commercial',
    label: 'Commercial Use',
    trueText: 'You may use in commercial/paid mods',
    falseText: 'Do not use in commercial/paid mods',
  },
]

export function ModPermissions({ permissions }: ModPermissionsProps) {
  return (
    <div className="rounded-lg border border-[#262626] bg-[#1c1c1c] overflow-hidden">
      {permissionRows.map((row, i) => {
        const allowed = permissions[row.key]
        return (
          <div key={row.key}>
            {i > 0 && <Separator className="bg-[#262626]" />}
            <div className={cn('flex items-start gap-3 px-4 py-3')}>
              {allowed ? (
                <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <p className="font-semibold text-white text-sm">{row.label}</p>
                <p className="text-sm text-neutral-400">
                  {allowed ? row.trueText : row.falseText}
                </p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
