'use client';

import { useCallback, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Copy,
  GripVertical,
  Layout,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Unlock,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useTerminalLayoutStore } from '@/stores/terminal-layout-store';
import {
  WIDGET_REGISTRY,
  CATEGORY_LABELS,
  type WidgetDefinition,
} from './widget-registry';

export function TerminalToolbar() {
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
  const renameInputRef = useRef<HTMLInputElement>(null);

  const activeWidgetIds = new Set(activeLayout?.widgets.map((w) => w.widgetId) ?? []);

  // Group widgets by category
  const widgetsByCategory = WIDGET_REGISTRY.reduce<
    Record<string, WidgetDefinition[]>
  >((acc, w) => {
    const cat = w.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(w);
    return acc;
  }, {});

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
    if (layouts.length <= 1) return;
    if (activeLayout) {
      deleteLayout(activeLayout.id);
    }
  }, [layouts.length, activeLayout, deleteLayout]);

  return (
    <div className="bg-card/80 border-border/50 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 backdrop-blur-sm">
      {/* Layout selector */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 px-3 text-xs">
            <Layout className="h-3.5 w-3.5" />
            <span className="max-w-[120px] truncate">{activeLayout?.name ?? 'Layout'}</span>
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
              {layout.id === activeLayoutId && <Check className="h-3.5 w-3.5" />}
              {layout.id !== activeLayoutId && <span className="w-3.5" />}
              <span className="flex-1 truncate">{layout.name}</span>
              <span className="text-muted-foreground text-[10px]">
                {String(layout.widgets.length)} widgets
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleCreateLayout} className="gap-2">
            <Plus className="h-3.5 w-3.5" />
            New Layout
          </DropdownMenuItem>
          {activeLayout && (
            <DropdownMenuItem
              onClick={() => duplicateLayout(activeLayout.id)}
              className="gap-2"
            >
              <Copy className="h-3.5 w-3.5" />
              Duplicate Current
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Layout name — inline editable */}
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
          className="bg-muted h-8 rounded-md border px-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-ring"
          style={{ width: `${Math.max(80, renameValue.length * 8)}px` }}
        />
      ) : (
        <button
          onClick={handleStartRename}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
          title="Click to rename"
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}

      <div className="bg-border mx-1 hidden h-4 w-px sm:block" />

      {/* Add Widget button */}
      <Popover open={addWidgetOpen} onOpenChange={setAddWidgetOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 px-3 text-xs">
            <Plus className="h-3.5 w-3.5" />
            Add Widget
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <div className="max-h-80 overflow-y-auto">
            {(Object.entries(widgetsByCategory) as Array<[string, WidgetDefinition[]]>).map(
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
                        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                          isActive
                            ? 'text-muted-foreground/40 cursor-not-allowed'
                            : 'hover:bg-muted/50'
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="flex-1">{w.label}</span>
                        {isActive && (
                          <Check className="text-muted-foreground/40 h-3.5 w-3.5" />
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

      {/* Edit toggle */}
      <Button
        variant={isEditing ? 'default' : 'outline'}
        size="sm"
        onClick={toggleEditing}
        className="h-8 gap-1.5 px-3 text-xs"
      >
        {isEditing ? (
          <>
            <Unlock className="h-3.5 w-3.5" />
            Editing
          </>
        ) : (
          <>
            <Lock className="h-3.5 w-3.5" />
            Locked
          </>
        )}
      </Button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Reset */}
      <Button
        variant="ghost"
        size="sm"
        onClick={resetToDefault}
        className="h-8 gap-1.5 px-3 text-xs"
        title="Reset to default"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Reset</span>
      </Button>

      {/* Delete */}
      {layouts.length > 1 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDeleteLayout}
          className="text-destructive hover:text-destructive h-8 gap-1.5 px-3 text-xs"
          title="Delete layout"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
