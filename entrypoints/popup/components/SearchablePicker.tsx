import { useState, useEffect, useRef } from 'preact/hooks';

export function SearchablePicker({
  value,
  onChange,
  suggested,
  all
}: {
  value: string;
  onChange: (code: string) => void;
  suggested: { code: string; label: string }[];
  all: { code: string; label: string }[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedLang = [...suggested, ...all].find(l => l.code === value);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
      // Auto-focus search input when opening
      setTimeout(() => inputRef.current?.focus(), 10);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const filteredSuggested = suggested.filter(l =>
    l.label.toLowerCase().includes(search.toLowerCase())
  );
  const filteredAll = all.filter(l =>
    l.label.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="sly-picker" ref={wrapperRef}>
      <button
        className={`sly-picker-trigger${isOpen ? ' active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <span className="sly-picker-label">{selectedLang?.label || 'Select Language'}</span>
        <svg className="sly-picker-arrow" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {isOpen && (
        <div className="sly-picker-dropdown">
          <div className="sly-picker-search-container">
            <input
              ref={inputRef}
              type="text"
              className="sly-picker-search"
              placeholder="Search languages..."
              value={search}
              onInput={e => setSearch((e.target as HTMLInputElement).value)}
            />
          </div>
          <div className="sly-picker-list">
            {filteredSuggested.length > 0 && (
              <div className="sly-picker-group">
                <div className="sly-picker-group-label">Common</div>
                {filteredSuggested.map(l => (
                  <div
                    key={l.code}
                    className={`sly-picker-item${value === l.code ? ' selected' : ''}`}
                    onClick={() => { onChange(l.code); setIsOpen(false); }}
                  >
                    {l.label}
                    {value === l.code && <span className="sly-picker-check">✓</span>}
                  </div>
                ))}
              </div>
            )}
            {filteredAll.length > 0 && (
              <div className="sly-picker-group">
                <div className="sly-picker-group-label">All Languages</div>
                {filteredAll.map(l => (
                  <div
                    key={l.code}
                    className={`sly-picker-item${value === l.code ? ' selected' : ''}`}
                    onClick={() => { onChange(l.code); setIsOpen(false); }}
                  >
                    {l.label}
                    {value === l.code && <span className="sly-picker-check">✓</span>}
                  </div>
                ))}
              </div>
            )}
            {filteredSuggested.length === 0 && filteredAll.length === 0 && (
              <div className="sly-picker-no-results">No languages found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
