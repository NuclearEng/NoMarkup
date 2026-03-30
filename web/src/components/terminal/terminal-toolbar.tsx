'use client';

import { useCallback, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Copy,
  Layout,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useTerminalLayoutStore } from '@/stores/terminal-layout-store';
import { WIDGET_CATEGORIES, CATEGORY_LABELS, type WidgetDefinition } from './widget-registry';

// ── Types ──

interface TerminalToolbarProps {
  className?: string;
}

// ── Component ──

export function TerminalToolbar({ className }: TerminalToolbarProps) {
  const {
    layouts,
    activeLayoutId,
    isEditing,
    setActiveLayout,
    createLayout,
    deleteLayout,
    renameLayout,
    duplicateLayout,
    addWidget,
    toggleEditing,
    resetToDefault,
  } = useTerminalLayoutStore();

  const activeLayout = layouts.find((l) => l.id === activeLayoutId);

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [addWidgetOpen, setAddWidgetOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const activeWidgetIds = new Set(activeLayout?.widgets.map((w) => w.widgetId) ?? []);

  // ── Handlers ──

  const handleStartRename = useCallback(() => {
    if (!activeLayout) return;
    setRenameValue(activeLayout.name);
    setIsRenaming(true);
    setTimeout(() => renameInputRef.current?.focus(), 50);
  }, [activeLayout]);

  const handleFinishRename = useCallback(() => {
    if (renameValue.trim() && activeLayout) {
      renameLayout(activeLayout.id, renameValue.trim());
    }
    setIsRenaming(false);
  }, [renameValue, activeLayout, renameLayout]);

  const handleCreateLayout = useCallback(() => {
    const name = `Layout ${String(layouts.length + 1)}`;
    createLayout(name);
  }, [layouts.length, createLayout]);

  const handleDeleteLayout = useCallback(() => {
    if (layouts.length <= 1 || !activeLayout) return;
    const deletedName = activeLayout.name;
    deleteLayout(activeLayout.id);
    setDeleteConfirmOpen(false);
    toast.success(`"${deletedName}" deleted`);
  }, [layouts.length, activeLayout, deleteLayout]);

  const handleSave = useCallback(() => {
    toast.success('Saved!', { duration: 1500 });
  }, []);

  const handleReset = useCallback(() => {
    resetToDefault();
    setResetConfirmOpen(false);
    toast.info('Layout reset to default');
  }, [resetToDefault]);

  return (
    <div
      className={cn(
        'flex h-10 items-center gap-1.5 rounded-2xl border border-white/[0.06] bg-zinc-900/80 px-3',
        className,
      )}
    >
      {/* ── Layout Selector ── */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 gap-1.5 border-zinc-700/60 bg-zinc-800/50 px-2.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100">
            <Layout className="h-3.5 w-3.5" />
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span className="max-w-[140px] truncate">{activeLayout?.name ?? 'Layout'}</span>
            <ChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {layouts.map((layout) => (
            <DropdownMenuItem
              key={layout.id}
              onClick={() => setActiveLayout(layout.id)}
              className="gap-2"
            >
              {layout.id === activeLayoutId ? (
                <Check className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <span className="w-3.5 shrink-0" />
              )}
              <span className="flex-1 truncate">{layout.name}</span>
              <span className="text-muted-foreground text-[10px]">
                {String(layout.widgets.length)} widgets
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleCreateLayout} className="gap-2">
            <Plus className="h-3.5 w-3.5" />
            New Layout...
          </DropdownMenuItem>
          {activeLayout && (
            <DropdownMenuItem onClick={() => duplicateLayout(activeLayout.id)} className="gap-2">
              <Copy className="h-3.5 w-3.5" />
              Duplicate Current
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* ── Layout Name (inline editable) ── */}
      {isRenaming ? (
        <input
          ref={renameInputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={handleFinishRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleFinishRename();
            if (e.key === 'Escape') setIsRenaming(false);
          }}
          className="bg-muted focus:ring-ring h-7 rounded-md border px-2 text-xs font-medium focus:ring-1 focus:outline-none"
          style={{ width: `${Math.max(80, renameValue.length * 8)}px` }}
          aria-label="Layout name"
        />
      ) : (
        <button
          onClick={handleStartRename}
          className="flex items-center gap-1 rounded px-1 py-0.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          title="Rename layout"
          aria-label="Rename layout"
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}

      <div className="mx-0.5 hidden h-4 w-px bg-zinc-700/50 sm:block" />

      {/* ── Add Widget ── */}
      <Popover open={addWidgetOpen} onOpenChange={setAddWidgetOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 border-zinc-700/60 px-2.5 text-xs text-zinc-300 hover:text-zinc-100"
            style={{
              background: 'linear-gradient(135deg, rgba(39,39,42,0.8), rgba(39,39,42,0.5))',
            }}
          >
            <Plus className="h-3.5 w-3.5 text-amber-400/80" />
            <span className="hidden sm:inline">Add Widget</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <div className="max-h-80 overflow-y-auto">
            {(Object.entries(WIDGET_CATEGORIES) as Array<[string, WidgetDefinition[]]>).map(
              ([category, widgets]) => (
                <div key={category}>
                  <div className="bg-muted/50 px-3 py-1.5">
                    <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
                      {CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] ?? category}
                    </p>
                  </div>
                  {widgets.map((w) => {
                    const isActive = activeWidgetIds.has(w.id);
                    const Icon = w.icon;
                    return (
                      <button
                        key={w.id}
                        onClick={() => {
                          if (!isActive) {
                            addWidget(w.id);
                            setAddWidgetOpen(false);
                          }
                        }}
                        disabled={isActive}
                        className={cn(
                          'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors',
                          isActive ? 'cursor-not-allowed opacity-40' : 'hover:bg-muted/50',
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="flex-1">{w.label}</span>
                        {isActive && (
                          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                            Active
                          </Badge>
                        )}
                      </button>
                    );
                  })}
                </div>
              ),
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* ── Edit Layout Toggle ── */}
      <Button
        variant={isEditing ? 'default' : 'outline'}
        size="sm"
        onClick={toggleEditing}
        className={cn(
          'h-7 gap-1.5 px-2.5 text-xs',
          isEditing
            ? 'bg-zinc-700 text-zinc-100 shadow-inner ring-1 ring-zinc-600'
            : 'border-zinc-700/60 bg-zinc-800/50 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100',
        )}
        aria-pressed={isEditing}
      >
        {isEditing ? (
          <>
            <Check className="h-3.5 w-3.5" />
            Done
          </>
        ) : (
          <>
            <Pencil className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Edit</span>
          </>
        )}
      </Button>

      {/* ── Save ── */}
      <Button
        variant="outline"
        size="sm"
        onClick={handleSave}
        className="h-7 gap-1.5 border-zinc-700/60 bg-zinc-800/50 px-2.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
        title="Save layout"
      >
        <Save className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Save</span>
      </Button>

      {/* ── Spacer ── */}
      <div className="flex-1" />

      {/* ── Reset ── */}
      <Popover open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            title="Reset to default"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 p-3">
          <p className="mb-3 text-sm">Reset this layout to its default configuration?</p>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setResetConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={handleReset}>
              Reset
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* ── Delete Layout ── */}
      {layouts.length > 1 && (
        <Popover open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-red-400/70 hover:bg-red-500/10 hover:text-red-400"
              title="Delete layout"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-3">
            <p className="mb-1 text-sm font-medium">Delete layout?</p>
            <p className="text-muted-foreground mb-3 text-xs">
              &ldquo;{activeLayout?.name}&rdquo; will be permanently removed.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setDeleteConfirmOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="h-7 text-xs"
                onClick={handleDeleteLayout}
              >
                Delete
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
