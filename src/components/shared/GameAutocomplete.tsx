import { useMemo } from 'react'
import { useGamesDbStore } from '@/stores/gamesDbStore'
import { SuggestInput } from '@/components/shared/SuggestInput'

interface GameAutocompleteProps {
  value: string
  onChange: (val: string) => void
  /** Fired when a game is picked from the suggestions dropdown. */
  onSelect?: (val: string) => void
  className?: string
  maxLength?: number
  placeholder?: string
  disabled?: boolean
}

/**
 * Game name input with suggestions from the games DB. Free text is always
 * allowed: the dropdown is only a convenience.
 */
export function GameAutocomplete({
  value,
  onChange,
  onSelect,
  className,
  maxLength,
  placeholder = 'Type or search game name',
  disabled,
}: GameAutocompleteProps) {
  const games = useGamesDbStore((s) => s.games)
  const items = useMemo(() => games.map((g) => g.name), [games])

  return (
    <SuggestInput
      value={value}
      onChange={onChange}
      onSelect={onSelect}
      items={items}
      minChars={2}
      placeholder={placeholder}
      className={className}
      maxLength={maxLength}
      disabled={disabled}
    />
  )
}
