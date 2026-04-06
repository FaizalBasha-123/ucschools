'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import {
    ReactFlow,
    Background,
    BaseEdge,
    Controls,
    Handle,
    MiniMap,
    Position,
    MarkerType,
    getSmoothStepPath,
    useNodesState,
    useEdgesState,
    useReactFlow,
    type Node,
    type Edge,
    type EdgeProps,
    BackgroundVariant,
    Panel,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from 'dagre'
import { useAuth } from '@/contexts/AuthContext'
import { api } from '@/lib/api'
import { ArrowLeft, Database, Loader2, KeyRound, Eye, EyeOff, Search, X, ChevronLeft, ChevronRight } from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────
interface SchemaColumn {
    name: string
    type: string
    nullable: boolean
    is_pk: boolean
}

interface SchemaFK {
    constraint_name: string
    source_table: string
    source_column: string
    target_schema: string  // may differ from schema_name for cross-schema FKs
    target_table: string
    target_column: string
}

interface SchemaTable {
    name: string
    columns: SchemaColumn[]
}

interface SchemaResponse {
    schema_name: string
    school_name?: string  // populated for tenant schemas
    tables: SchemaTable[]
    foreign_keys: SchemaFK[]
}

interface AllSchemasResponse {
    schemas: SchemaResponse[]
}

interface SchemaEdgeData extends Record<string, unknown> {
    sourceSchema: string
    sourceTable: string
    sourceColumn: string
    targetSchema: string
    targetTable: string
    targetColumn: string
}

type SchemaMode = 'public' | 'tenant' | 'all'

// ─── Schema colour palette (used to distinguish schemas in "all" mode) ──────
const SCHEMA_COLORS = [
    '#6366f1', // indigo (public)
    '#10b981', // emerald
    '#f59e0b', // amber
    '#ef4444', // red
    '#8b5cf6', // violet
    '#06b6d4', // cyan
    '#f97316', // orange
    '#ec4899', // pink
    '#14b8a6', // teal
    '#a855f7', // purple
]

// ─── Dagre layout helper ────────────────────────────────────────────────────
const NODE_WIDTH = 280
// Ghost public tables are shown in a distinct cool-indigo that reads as
// "platform / global" and clearly differs from the tenant schema colour.
const PUBLIC_GHOST_COLOR = '#818cf8' // indigo-400
const COL_ROW_HEIGHT = 24
// NODE_HEADER: 44 base + 12 extra for the optional school-name subtitle row
const NODE_HEADER = 56
const NODE_PADDING = 16

function layoutSingleSchema(
    tables: SchemaTable[],
    fks: SchemaFK[],
    prefix: string,
    schemaName: string,   // actual schema name (used for FK filtering)
    schoolName: string | undefined,  // human-readable school name for tenant schemas
    color: string,
    offsetX: number,
    offsetY: number,
    showLinkedPublic = false, // when true, synthesise ghost nodes for cross-schema FK targets
) {
    const g = new dagre.graphlib.Graph()
    g.setDefaultEdgeLabel(() => ({}))
    g.setGraph({ rankdir: 'LR', ranksep: 120, nodesep: 60, marginx: 40, marginy: 40 })

    const tableSet = new Set(tables.map(t => t.name))

    // Within-schema FKs — drawn as edges on the canvas.
    const drawableFks = fks.filter(fk => tableSet.has(fk.target_table) && fk.target_schema === schemaName)

    // Cross-schema FKs whose source is a real tenant table — used to build ghost public nodes.
    const crossFks = showLinkedPublic
        ? fks.filter(fk => fk.target_schema !== schemaName && tableSet.has(fk.source_table))
        : []

    // ── 1. Register main tenant nodes with Dagre ──────────────────────────
    const nodes: Node[] = tables.map(t => {
        const h = NODE_HEADER + t.columns.length * COL_ROW_HEIGHT + NODE_PADDING
        const nodeId = prefix ? `${prefix}::${t.name}` : t.name
        g.setNode(nodeId, { width: NODE_WIDTH, height: h })
        return {
            id: nodeId,
            type: 'tableNode',
            position: { x: 0, y: 0 },
            data: { label: t.name, table: t, schemaName: schemaName, schoolName, color, allFks: fks },
            style: { width: NODE_WIDTH, height: h },
        }
    })

    // ── 2. Register within-schema FK edges with Dagre ─────────────────────
    drawableFks.forEach(fk => {
        const src = prefix ? `${prefix}::${fk.source_table}` : fk.source_table
        const tgt = prefix ? `${prefix}::${fk.target_table}` : fk.target_table
        g.setEdge(src, tgt)
    })

    // ── 3. Build ghost public nodes + register with Dagre ─────────────────
    if (showLinkedPublic && crossFks.length > 0) {
        // Group by target_schema::target_table and collect referenced columns.
        const ghostMap = new Map<string, { schema: string; cols: Set<string> }>()
        crossFks.forEach(fk => {
            const key = `${fk.target_schema}::${fk.target_table}`
            if (!ghostMap.has(key)) ghostMap.set(key, { schema: fk.target_schema, cols: new Set() })
            ghostMap.get(key)!.cols.add(fk.target_column)
        })

        // Ghost node height: compact fixed size — no column rows are rendered.
        const GHOST_NODE_H = NODE_HEADER + 28 + NODE_PADDING // header + one reference line

        ghostMap.forEach(({ schema }, key) => {
            const tableName = key.split('::')[1]
            const ghostId = `__ghost__${key}`
            g.setNode(ghostId, { width: NODE_WIDTH, height: GHOST_NODE_H })
            nodes.push({
                id: ghostId,
                type: 'tableNode',
                position: { x: 0, y: 0 },
                data: {
                    label: tableName,
                    table: { name: tableName, columns: [] },
                    schemaName: schema,
                    schoolName: undefined,
                    color: PUBLIC_GHOST_COLOR,
                    allFks: [],
                    isGhost: true,
                    ghostSchema: schema,
                },
                style: { width: NODE_WIDTH, height: GHOST_NODE_H },
            })
        })

        // Register cross-schema edges with Dagre so they influence layout.
        crossFks.forEach(fk => {
            const src = prefix ? `${prefix}::${fk.source_table}` : fk.source_table
            const tgt = `__ghost__${fk.target_schema}::${fk.target_table}`
            g.setEdge(src, tgt)
        })
    }

    // ── 4. Run Dagre layout (all nodes including ghosts are registered) ────
    dagre.layout(g)

    nodes.forEach(n => {
        const pos = g.node(n.id)
        if (pos) {
            n.position = {
                x: pos.x - NODE_WIDTH / 2 + offsetX,
                y: pos.y - (pos.height ?? 200) / 2 + offsetY,
            }
        }
    })

    // ── 5. Build edge objects ─────────────────────────────────────────────
    const edges: Edge[] = drawableFks.map((fk, i) => ({
        id: prefix ? `${prefix}-fk-${i}` : `fk-${i}`,
        type: 'schemaRelation',
        source: prefix ? `${prefix}::${fk.source_table}` : fk.source_table,
        target: prefix ? `${prefix}::${fk.target_table}` : fk.target_table,
        animated: false,
        zIndex: 50,
        style: { stroke: color, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
        data: {
            sourceSchema: schemaName,
            sourceTable: fk.source_table,
            sourceColumn: fk.source_column,
            targetSchema: fk.target_schema,
            targetTable: fk.target_table,
            targetColumn: fk.target_column,
        },
    }))

    // Cross-schema edges (dashed, distinct colour)
    if (showLinkedPublic) {
        const seenEdges = new Set<string>()
        crossFks.forEach((fk, i) => {
            const src = prefix ? `${prefix}::${fk.source_table}` : fk.source_table
            const tgt = `__ghost__${fk.target_schema}::${fk.target_table}`
            const edgeKey = `${src}→${tgt}:${fk.source_column}`
            if (seenEdges.has(edgeKey)) return
            seenEdges.add(edgeKey)
            edges.push({
                id: prefix ? `${prefix}-cross-${i}` : `cross-${i}`,
                type: 'schemaRelation',
                source: src,
                target: tgt,
                animated: false,
                zIndex: 60,
                style: {
                    stroke: PUBLIC_GHOST_COLOR,
                    strokeWidth: 1.75,
                    strokeDasharray: '6 4',
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                },
                markerEnd: { type: MarkerType.ArrowClosed, color: PUBLIC_GHOST_COLOR, width: 16, height: 16 },
                data: {
                    sourceSchema: schemaName,
                    sourceTable: fk.source_table,
                    sourceColumn: fk.source_column,
                    targetSchema: fk.target_schema,
                    targetTable: fk.target_table,
                    targetColumn: fk.target_column,
                },
            })
        })
    }

    // ── 6. Bounding box ───────────────────────────────────────────────────
    let maxX = 0, maxY = 0
    nodes.forEach(n => {
        const r = n.position.x + NODE_WIDTH
        const b = n.position.y + (typeof n.style?.height === 'number' ? n.style.height : 200)
        if (r > maxX) maxX = r
        if (b > maxY) maxY = b
    })

    return { nodes, edges, width: maxX - offsetX, height: maxY - offsetY }
}

// ─── Grid layout for "all" mode ─────────────────────────────────────────────
const GROUP_PAD = 30
const GROUP_LABEL_H = 50
const TBL_GAP_X = 40
const TBL_GAP_Y = 24
const GROUPS_PER_ROW = 2

function gridLayoutAllSchemas(schemas: SchemaResponse[]) {
    const allNodes: Node[] = []
    const allEdges: Edge[] = []

    const publicSchema = schemas.find(s => s.schema_name === 'public')
    const tenantSchemas = schemas.filter(s => s.schema_name !== 'public')

    function layoutGroup(sr: SchemaResponse, color: string, gx: number, gy: number, maxCols: number) {
        const tables = sr.tables ?? []
        const fks = sr.foreign_keys ?? []
        const cols = Math.min(maxCols, tables.length || 1)
        const rows = Math.ceil(tables.length / cols) || 1

        const tH = tables.map(t => NODE_HEADER + t.columns.length * COL_ROW_HEIGHT + NODE_PADDING)
        const rowMaxH: number[] = []
        for (let r = 0; r < rows; r++) {
            let mx = 0
            for (let c = 0; c < cols; c++) {
                const idx = r * cols + c
                if (idx < tables.length) mx = Math.max(mx, tH[idx])
            }
            rowMaxH.push(mx)
        }

        const rowY = [GROUP_LABEL_H + GROUP_PAD]
        for (let r = 1; r < rows; r++) rowY.push(rowY[r - 1] + rowMaxH[r - 1] + TBL_GAP_Y)

        const gw = cols * (NODE_WIDTH + TBL_GAP_X) - TBL_GAP_X + GROUP_PAD * 2
        const gh = (rows > 0 ? rowY[rows - 1] + rowMaxH[rows - 1] : GROUP_LABEL_H + GROUP_PAD) + GROUP_PAD

        const groupId = `__group__${sr.schema_name}`
        allNodes.push({
            id: groupId,
            type: 'schemaGroup',
            position: { x: gx, y: gy },
            data: { label: sr.schema_name, schoolName: sr.school_name, color, tableCount: tables.length, fkCount: fks.length, width: gw, height: gh },
            style: { width: gw, height: gh },
        })

        tables.forEach((t, i) => {
            const row = Math.floor(i / cols)
            const col = i % cols
            allNodes.push({
                id: `${sr.schema_name}::${t.name}`,
                type: 'tableNode',
                parentId: groupId,
                extent: 'parent' as const,
                position: { x: GROUP_PAD + col * (NODE_WIDTH + TBL_GAP_X), y: rowY[row] },
                data: { label: t.name, table: t, schemaName: sr.schema_name, schoolName: sr.school_name, color, allFks: fks },
                style: { width: NODE_WIDTH, height: tH[i] },
            })
        })

        const tableNameSet = new Set(tables.map(t => t.name))
        fks.forEach((fk, i) => {
            // Skip cross-schema FKs here — they are emitted separately after all groups are built.
            if (!tableNameSet.has(fk.target_table) || fk.target_schema !== sr.schema_name) return
            allEdges.push({
                id: `${sr.schema_name}-fk-${i}`,
                type: 'schemaRelation',
                source: `${sr.schema_name}::${fk.source_table}`,
                target: `${sr.schema_name}::${fk.target_table}`,
                animated: false,
                zIndex: 50,
                style: { stroke: color, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
                markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
                data: {
                    sourceSchema: sr.schema_name,
                    sourceTable: fk.source_table,
                    sourceColumn: fk.source_column,
                    targetSchema: fk.target_schema,
                    targetTable: fk.target_table,
                    targetColumn: fk.target_column,
                },
            })
        })

        return { width: gw, height: gh }
    }

    let globalY = 0

    // Public schema — wider grid at top
    if (publicSchema) {
        const { height } = layoutGroup(publicSchema, SCHEMA_COLORS[0], 0, 0, 8)
        globalY = height + 80
    }

    // Tenant schemas — 2 per row
    // Track schema → color for cross-schema edge coloring
    const schemaColorMap = new Map<string, string>()
    if (publicSchema) schemaColorMap.set('public', SCHEMA_COLORS[0])

    let rowX = 0
    let rowMaxH = 0
    let colIdx = 0

    tenantSchemas.forEach((sr, i) => {
        const color = SCHEMA_COLORS[(i + 1) % SCHEMA_COLORS.length]
        schemaColorMap.set(sr.schema_name, color)
        const { width, height } = layoutGroup(sr, color, rowX, globalY, 4)
        rowMaxH = Math.max(rowMaxH, height)
        colIdx++
        if (colIdx >= GROUPS_PER_ROW) {
            globalY += rowMaxH + 80
            rowX = 0
            rowMaxH = 0
            colIdx = 0
        } else {
            rowX += width + 80
        }
    })

    // Emit cross-schema edges — drawn after all groups are built so both
    // source and target nodes are guaranteed to exist in allNodes.
    const globalNodeIdSet = new Set(
        allNodes.filter(n => n.type === 'tableNode').map(n => n.id)
    )
    schemas.forEach((sr) => {
        const fks = sr.foreign_keys ?? []
        const srcColor = schemaColorMap.get(sr.schema_name) ?? '#71717a'
        fks.forEach((fk, i) => {
            // Only cross-schema FKs (within-schema already emitted above).
            if (fk.target_schema === sr.schema_name) return
            const srcId = `${sr.schema_name}::${fk.source_table}`
            const tgtId = `${fk.target_schema}::${fk.target_table}`
            if (!globalNodeIdSet.has(srcId) || !globalNodeIdSet.has(tgtId)) return
            allEdges.push({
                id: `cross-${sr.schema_name}-fk-${i}`,
                type: 'schemaRelation',
                source: srcId,
                target: tgtId,
                animated: false,
                zIndex: 100,
                style: { stroke: srcColor, strokeWidth: 1.75, strokeDasharray: '6 4', strokeLinecap: 'round', strokeLinejoin: 'round' },
                markerEnd: { type: MarkerType.ArrowClosed, color: srcColor, width: 18, height: 18 },
                data: {
                    sourceSchema: sr.schema_name,
                    sourceTable: fk.source_table,
                    sourceColumn: fk.source_column,
                    targetSchema: fk.target_schema,
                    targetTable: fk.target_table,
                    targetColumn: fk.target_column,
                },
            })
        })
    })

    return { nodes: allNodes, edges: allEdges }
}

// ─── Custom node renderers ──────────────────────────────────────────────────

// Tracks which column is being hovered (content only — no coordinates).
// Coordinates are written directly to the portal DOM node to avoid React
// re-renders on every pixel of cursor movement.
interface HoveredCol {
    col: SchemaColumn
    fkInfo: SchemaFK | undefined
    // Initial viewport position captured on mouseenter (for first-render placement)
    ix: number
    iy: number
}

function ColumnTooltip({ data, nodeRef }: { data: HoveredCol; nodeRef: React.RefObject<HTMLDivElement | null> }) {
    const flipX = data.ix + 330 > window.innerWidth
    const flipY = data.iy + 160 > window.innerHeight
    return (
        <div
            ref={nodeRef}
            className="pointer-events-none fixed z-[9999] rounded-xl border border-zinc-700/90 bg-zinc-950/98 px-3 py-2.5 shadow-2xl"
            style={{
                left: flipX ? data.ix - 314 : data.ix + 16,
                top: flipY ? data.iy - 150 : data.iy + 14,
                maxWidth: 298,
                minWidth: 200,
            }}
        >
            <p className="font-bold text-zinc-100 text-xs tracking-wide">{data.col.name}</p>
            <p className="mt-0.5 text-zinc-400 text-[11px] font-mono">{data.col.type}</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
                {data.col.is_pk && (
                    <span className="rounded bg-amber-500/20 text-amber-300 px-1.5 py-0.5 text-[10px] font-semibold">PRIMARY KEY</span>
                )}
                {data.fkInfo && (
                    <span className="rounded bg-sky-500/20 text-sky-300 px-1.5 py-0.5 text-[10px] font-semibold">FOREIGN KEY</span>
                )}
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    data.col.nullable ? 'bg-zinc-700/50 text-zinc-500' : 'bg-zinc-700/40 text-zinc-300'
                }`}>
                    {data.col.nullable ? 'NULL' : 'NOT NULL'}
                </span>
            </div>
            {data.fkInfo && (
                <div className="mt-2 pt-2 border-t border-zinc-800 space-y-0.5">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">References</p>
                    <p className="font-mono text-[11px]">
                        <span className="text-sky-300">{data.fkInfo.target_schema}.{data.fkInfo.target_table}</span>
                        <span className="text-zinc-500">(</span>
                        <span className="text-indigo-300">{data.fkInfo.target_column}</span>
                        <span className="text-zinc-500">)</span>
                    </p>
                    <p className="text-[10px] text-zinc-600 font-mono">{data.fkInfo.constraint_name}</p>
                </div>
            )}
        </div>
    )
}

function TableNode({ data }: { data: { label: string; table: SchemaTable; schemaName?: string; schoolName?: string; color?: string; allFks?: SchemaFK[]; isGhost?: boolean; ghostSchema?: string; edgeHighlighted?: boolean } }) {
    const { table, color = '#6366f1', allFks = [], isGhost = false, edgeHighlighted = false } = data

    // Content state: only updates when cursor enters a new row (low-frequency).
    const [hoverCol, setHoverCol] = useState<HoveredCol | null>(null)
    // Position ref: updated directly on every mousemove — no React re-render per pixel.
    const ttRef = useRef<HTMLDivElement>(null)
    const moveTip = useCallback((e: React.MouseEvent) => {
        const el = ttRef.current
        if (!el) return
        const flipX = e.clientX + 330 > window.innerWidth
        const flipY = e.clientY + 160 > window.innerHeight
        el.style.left = `${flipX ? e.clientX - 314 : e.clientX + 16}px`
        el.style.top = `${flipY ? e.clientY - 150 : e.clientY + 14}px`
    }, [])

    // Build a map: columnName → FK info (for badge rendering)
    const fkMap = new Map<string, SchemaFK>()
    allFks.forEach(fk => {
        if (fk.source_table === table.name) fkMap.set(fk.source_column, fk)
    })

    // Border + optional glow ring when this table is an endpoint of the hovered edge
    const borderClass = isGhost
        ? 'border-dashed border-indigo-400/50 opacity-85'
        : edgeHighlighted
            ? 'border-sky-400'
            : 'border-zinc-700'

    return (
        <div
            className={`relative rounded-lg border bg-zinc-900 text-zinc-100 overflow-hidden shadow-xl min-w-[260px] transition-[border-color,box-shadow] duration-100 ${borderClass}`}
            style={edgeHighlighted && !isGhost ? { boxShadow: `0 0 0 3px ${color}44, 0 0 16px 2px ${color}22` } : undefined}
            onMouseMove={moveTip}
        >
            <Handle
                type="target"
                position={Position.Left}
                className="!w-2.5 !h-2.5 !border-2 !border-zinc-950 !bg-sky-500 !opacity-0"
            />
            <Handle
                type="source"
                position={Position.Right}
                className="!w-2.5 !h-2.5 !border-2 !border-zinc-950 !bg-indigo-500 !opacity-0"
            />
            <div
                className="px-3 py-2 flex flex-col gap-0.5"
                style={{ backgroundColor: `${color}${isGhost ? '88' : 'cc'}` }}
            >
                <div className="flex items-center gap-2">
                    <Database className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-bold text-sm tracking-wide truncate">{table.name}</span>
                    {isGhost && (
                        <span className="ml-auto rounded bg-indigo-900/60 border border-indigo-400/30 text-indigo-200 text-[9px] px-1.5 py-0.5 font-semibold uppercase tracking-wide shrink-0">
                            {data.ghostSchema ?? 'public'}
                        </span>
                    )}
                </div>
                {data.schoolName && !isGhost && (
                    <span className="text-[10px] text-white/65 ml-5 truncate leading-tight">{data.schoolName}</span>
                )}
                {isGhost && (
                    <span className="text-[10px] text-indigo-200/50 ml-5 truncate leading-tight">referenced via foreign key</span>
                )}
            </div>
            {isGhost ? (
                // Ghost nodes show the fully-qualified table name in place of column rows.
                // They are external references — showing their column detail adds noise.
                <div className="px-3 py-2 flex items-center gap-1.5">
                    <span className="text-indigo-400 text-[10px] font-mono font-semibold">
                        {data.ghostSchema ?? 'public'}
                    </span>
                    <span className="text-zinc-600 text-[10px] font-mono">.</span>
                    <span className="text-zinc-100 text-[10px] font-mono font-bold">{table.name}</span>
                </div>
            ) : (
                <div className="divide-y divide-zinc-800">
                    {table.columns.map(col => {
                        const fkInfo = fkMap.get(col.name)
                        return (
                            <div
                                key={col.name}
                                className="flex items-center gap-2 px-3 py-1 text-xs font-mono hover:bg-zinc-800/60 cursor-default"
                                onMouseEnter={(e) => setHoverCol({ col, fkInfo, ix: e.clientX, iy: e.clientY })}
                                onMouseLeave={() => setHoverCol(null)}
                            >
                                {col.is_pk && <span className="text-amber-400 font-bold text-[10px]">PK</span>}
                                {!col.is_pk && fkInfo && <span className="text-sky-400 font-bold text-[10px]">FK</span>}
                                {!col.is_pk && !fkInfo && <span className="w-[18px]" />}
                                <span className="text-zinc-200 flex-1 truncate">{col.name}</span>
                                {fkInfo && (
                                    <span className="text-sky-600 text-[10px] truncate max-w-[90px]" title={`${fkInfo.target_schema}.${fkInfo.target_table}`}>
                                        → {fkInfo.target_table}
                                    </span>
                                )}
                                {!fkInfo && <span className="text-zinc-500">{col.type}</span>}
                                {col.nullable && <span className="text-zinc-600 text-[10px]">NULL</span>}
                            </div>
                        )
                    })}
                </div>
            )}
            {hoverCol && typeof document !== 'undefined' && createPortal(
                <ColumnTooltip data={hoverCol} nodeRef={ttRef} />,
                document.body
            )}
        </div>
    )
}

function SchemaGroupNode({ data }: { data: { label: string; schoolName?: string; color: string; tableCount: number; fkCount: number; width: number; height: number } }) {
    return (
        <div
            style={{ width: data.width, height: data.height, borderColor: `${data.color}50`, backgroundColor: `${data.color}08` }}
            className="rounded-xl border-2 border-dashed"
        >
            <div className="flex items-center gap-2 px-4 py-3">
                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: data.color }} />
                <span className="font-mono text-sm font-bold truncate" style={{ color: data.color }}>{data.label}</span>
                {data.schoolName && (
                    <span className="text-zinc-300 text-xs font-semibold truncate">({data.schoolName})</span>
                )}
                <span className="text-zinc-500 text-xs whitespace-nowrap">{data.tableCount} tables · {data.fkCount} FKs</span>
            </div>
        </div>
    )
}

function SchemaRelationEdge(props: EdgeProps<Edge<SchemaEdgeData>>) {
    const [isHovered, setIsHovered] = useState(false)
    // Initial enter position — sets first-render placement of the portal tooltip.
    const [enterPos, setEnterPos] = useState({ x: 0, y: 0 })
    // Position ref — updated directly on mousemove so no React re-render per pixel.
    const ttRef = useRef<HTMLDivElement>(null)
    const moveTip = useCallback((e: React.MouseEvent) => {
        const el = ttRef.current
        if (!el) return
        const flipX = e.clientX + 300 > window.innerWidth
        const flipY = e.clientY + 130 > window.innerHeight
        el.style.left = `${flipX ? e.clientX - 316 : e.clientX + 16}px`
        el.style.top = `${flipY ? e.clientY - 124 : e.clientY + 14}px`
    }, [])

    // Highlight the two endpoint table nodes while this edge is hovered
    const { setNodes } = useReactFlow()
    const highlightEndpoints = useCallback((on: boolean) => {
        setNodes(nds => nds.map(n =>
            n.id === props.source || n.id === props.target
                ? { ...n, data: { ...n.data, edgeHighlighted: on } }
                : n
        ))
    }, [props.source, props.target, setNodes])

    const [path] = getSmoothStepPath({
        sourceX: props.sourceX,
        sourceY: props.sourceY,
        targetX: props.targetX,
        targetY: props.targetY,
        sourcePosition: props.sourcePosition,
        targetPosition: props.targetPosition,
        borderRadius: 18,
        offset: 30,
    })

    const meta = props.data
    const hovered = isHovered || Boolean(props.selected)
    const isCross = meta && meta.sourceSchema !== meta.targetSchema

    // Edge colour from the style prop so the tooltip border matches the line
    const lineColor = String(props.style?.stroke ?? '#6366f1')

    return (
        <>
            <BaseEdge
                id={props.id}
                path={path}
                markerEnd={props.markerEnd}
                style={{
                    ...props.style,
                    strokeWidth: hovered ? 3 : Number(props.style?.strokeWidth ?? 2),
                    opacity: hovered ? 1 : 0.85,
                    transition: 'stroke-width 100ms, opacity 100ms',
                }}
            />
            {/* Wide transparent hit-area so the line is easy to hover */}
            <path
                d={path}
                fill="none"
                stroke="transparent"
                strokeWidth={22}
                style={{ cursor: 'crosshair' }}
                onMouseEnter={(e) => { setIsHovered(true); setEnterPos({ x: e.clientX, y: e.clientY }); highlightEndpoints(true) }}
                onMouseMove={moveTip}
                onMouseLeave={() => { setIsHovered(false); highlightEndpoints(false) }}
            />
            {/* Cursor-following portal tooltip — initial position from enterPos, then updated via ref */}
            {hovered && meta && typeof document !== 'undefined' && createPortal(
                <div
                    ref={ttRef}
                    className="pointer-events-none fixed z-[9999] rounded-xl border shadow-2xl px-3 py-2.5 text-zinc-100 text-[11px]"
                    style={{
                        left: enterPos.x + 16 + 300 > window.innerWidth ? enterPos.x - 316 : enterPos.x + 16,
                        top: enterPos.y + 14 + 120 > window.innerHeight ? enterPos.y - 124 : enterPos.y + 14,
                        borderColor: `${lineColor}80`,
                        backgroundColor: 'rgba(9,9,11,0.97)',
                        minWidth: 240,
                    }}
                >
                    <div className="flex items-center gap-2 mb-1.5">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: lineColor }} />
                        <span className="font-semibold text-xs text-zinc-200">Foreign Key</span>
                        {isCross && (
                            <span className="ml-auto rounded bg-amber-500/20 text-amber-300 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide">cross-schema</span>
                        )}
                    </div>
                    <div className="space-y-1 font-mono">
                        <div className="flex items-baseline gap-1.5">
                            <span className="text-[9px] text-zinc-500 w-8 shrink-0">from</span>
                            <span className="text-sky-300 break-all">{meta.sourceSchema}.<span className="text-zinc-200">{meta.sourceTable}</span>.<span className="text-sky-400">{meta.sourceColumn}</span></span>
                        </div>
                        <div className="flex items-baseline gap-1.5">
                            <span className="text-[9px] text-zinc-500 w-8 shrink-0">to</span>
                            <span className="text-indigo-300 break-all">{meta.targetSchema}.<span className="text-zinc-200">{meta.targetTable}</span>.<span className="text-indigo-400">{meta.targetColumn}</span></span>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </>
    )
}

const nodeTypes = { tableNode: TableNode, schemaGroup: SchemaGroupNode }
const edgeTypes = { schemaRelation: SchemaRelationEdge }

// ─── Search panel (rendered inside <ReactFlow> so it can call useReactFlow) ──
// Supports full JS regex. Cycles through all matching tableNode nodes.
// fitView() smoothly animates the viewport to each match.
function SearchPanel() {
    const [query, setQuery] = useState('')
    const [matchIds, setMatchIds] = useState<string[]>([])
    // Ref mirrors matchIds so clearHighlights can be called outside of state updaters
    // (calling setNodes inside a setMatchIds updater triggers the BatchProvider warning).
    const matchIdsRef = useRef<string[]>([])
    const [matchIdx, setMatchIdx] = useState(0)
    const inputRef = useRef<HTMLInputElement>(null)
    const { fitView, getNodes, setNodes } = useReactFlow()

    const clearHighlights = useCallback((ids: string[]) => {
        if (ids.length === 0) return
        setNodes(nds => nds.map(n =>
            ids.includes(n.id) ? { ...n, selected: false } : n
        ))
    }, [setNodes])

    const runSearch = useCallback((q: string) => {
        setQuery(q)
        if (!q.trim()) {
            // Clear sequentially — never call setNodes inside a state updater
            clearHighlights(matchIdsRef.current)
            setMatchIds([])
            matchIdsRef.current = []
            return
        }
        let rx: RegExp
        try {
            rx = new RegExp(q, 'i')
        } catch {
            // Invalid regex — fall back to literal match
            rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
        }
        const hits = getNodes()
            .filter(n => n.type === 'tableNode' && rx.test(String(n.data?.label ?? '')))
            .map(n => n.id)
        clearHighlights(matchIdsRef.current)
        setMatchIds(hits)
        matchIdsRef.current = hits
        setMatchIdx(0)
        if (hits.length > 0) {
            // Highlight all matches, fly to first
            setNodes(nds => nds.map(n => ({
                ...n,
                selected: hits.includes(n.id),
            })))
            fitView({ nodes: [{ id: hits[0] }], duration: 420, padding: 0.35, maxZoom: 1.4 })
        }
    }, [fitView, getNodes, setNodes, clearHighlights])

    const jump = useCallback((dir: 1 | -1) => {
        if (matchIds.length === 0) return
        const next = (matchIdx + dir + matchIds.length) % matchIds.length
        setMatchIdx(next)
        fitView({ nodes: [{ id: matchIds[next] }], duration: 320, padding: 0.35, maxZoom: 1.4 })
    }, [matchIds, matchIdx, fitView])

    const clear = useCallback(() => {
        clearHighlights(matchIdsRef.current)
        setQuery('')
        setMatchIds([])
        matchIdsRef.current = []
        setMatchIdx(0)
    }, [clearHighlights])

    const isRegexValid = (() => {
        if (!query) return true
        try { new RegExp(query); return true } catch { return false }
    })()

    return (
        <Panel position="top-left" style={{ margin: '10px 0 0 10px' }}>
            <div className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm px-2.5 py-1.5 shadow-2xl">
                <Search className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                <input
                    ref={inputRef}
                    value={query}
                    onChange={e => runSearch(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') jump(e.shiftKey ? -1 : 1)
                        if (e.key === 'Escape') clear()
                    }}
                    placeholder="Search table… (regex)"
                    spellCheck={false}
                    className={`bg-transparent text-xs placeholder:text-zinc-600 outline-none w-[180px] font-mono ${
                        !isRegexValid ? 'text-red-400' : 'text-zinc-200'
                    }`}
                />
                {query && matchIds.length > 0 && (
                    <>
                        <span className="text-[10px] text-zinc-500 whitespace-nowrap tabular-nums">
                            {matchIdx + 1}/{matchIds.length}
                        </span>
                        <button
                            onClick={() => jump(-1)}
                            title="Previous match (Shift+Enter)"
                            className="text-zinc-500 hover:text-zinc-200 transition-colors"
                        >
                            <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        <button
                            onClick={() => jump(1)}
                            title="Next match (Enter)"
                            className="text-zinc-500 hover:text-zinc-200 transition-colors"
                        >
                            <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                    </>
                )}
                {query && matchIds.length === 0 && (
                    <span className="text-[10px] text-red-400 whitespace-nowrap">
                        {isRegexValid ? 'no match' : 'bad regex'}
                    </span>
                )}
                {query && (
                    <button onClick={clear} title="Clear (Esc)" className="text-zinc-600 hover:text-zinc-300 transition-colors ml-0.5">
                        <X className="h-3 w-3" />
                    </button>
                )}
            </div>
        </Panel>
    )
}

// Module-level cache — school list fetched once per browser session,
// not on every component mount (avoids a fresh DB read each navigation).
let _schoolsCache: Array<{ id: string; name: string }> | null = null

// ─── Page ───────────────────────────────────────────────────────────────────
export default function SchemaViewerPage() {
    const { user, isLoading: authLoading, userRole } = useAuth()
    const router = useRouter()

    // Re-authentication gate
    const [authenticated, setAuthenticated] = useState(false)
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [authError, setAuthError] = useState('')

    // School list for tenant selection dropdown — seeded from module-level cache if available
    const [schools, setSchools] = useState<Array<{ id: string; name: string }>>(_schoolsCache ?? [])
    useEffect(() => {
        if (_schoolsCache !== null || !user || userRole !== 'super_admin') return
        api.get<any>('/super-admin/schools?page_size=100')
            .then(res => {
                const list = res?.schools ?? res?.data ?? []
                _schoolsCache = list.map((s: any) => ({ id: s.id, name: s.name }))
                setSchools(_schoolsCache!)
            })
            .catch(() => { /* non-critical, UUID input still works */ })
    }, [user, userRole])

    // Schema selection
    const [schemaMode, setSchemaMode] = useState<SchemaMode>('public')
    const [schoolId, setSchoolId] = useState('')

    // Data
    const [displayInfo, setDisplayInfo] = useState({ label: '', tables: 0, fks: 0 })
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    // React Flow
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

    // Role gate — only super_admin, else 404-style blank
    if (!authLoading && (!user || userRole !== 'super_admin')) {
        return (
            <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
                <p className="text-zinc-500 text-sm">404 — Not Found</p>
            </div>
        )
    }

    function resolveSchemaName(): string | null {
        if (schemaMode === 'public') return 'public'
        if (schemaMode === 'all') return 'all'
        // tenant — validate school ID looks like a UUID
        const trimmed = schoolId.trim()
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
            return null
        }
        return `school_${trimmed}`
    }

    const canFetch = (): boolean => {
        if (!password) return false
        if (schemaMode === 'tenant' && !schoolId.trim()) return false
        return true
    }

    const processResponse = useCallback((mode: SchemaMode, responseData: any) => {
        if (mode === 'all') {
            const allData = responseData as AllSchemasResponse
            const schemas = allData.schemas ?? []
            const totalTables = schemas.reduce((sum: number, s: SchemaResponse) => sum + (s.tables?.length ?? 0), 0)
            const totalFks = schemas.reduce((sum: number, s: SchemaResponse) => sum + (s.foreign_keys?.length ?? 0), 0)
            setDisplayInfo({ label: `all (${schemas.length} schemas)`, tables: totalTables, fks: totalFks })

            const { nodes: allNodes, edges: allEdges } = gridLayoutAllSchemas(schemas)
            setNodes(allNodes)
            setEdges(allEdges)
        } else {
            const data = responseData as SchemaResponse
            const label = data.school_name
                ? `${data.schema_name} · ${data.school_name}`
                : data.schema_name
            setDisplayInfo({ label, tables: data.tables?.length ?? 0, fks: data.foreign_keys?.length ?? 0 })

            const color = SCHEMA_COLORS[0]
            const { nodes: layoutNodes, edges: layoutEdges } = layoutSingleSchema(
                data.tables, data.foreign_keys ?? [], '', data.schema_name, data.school_name, color, 0, 0,
                mode === 'tenant',   // show ghost public nodes only in tenant view
            )
            setNodes(layoutNodes)
            setEdges(layoutEdges)
        }
    }, [setNodes, setEdges])

    // Single API call — backend discovers schemas via information_schema.schemata,
    // introspects each with shared DB pool. One bcrypt instead of N+1.
    const handleFetch = useCallback(async () => {
        if (!canFetch()) return
        setLoading(true)
        setError('')
        setAuthError('')
        try {
            const sn = resolveSchemaName()
            if (!sn) {
                setAuthError('Enter a valid school UUID for tenant mode')
                return
            }
            const data = await api.post<any>('/super-admin/schema', { password, schema_name: sn })
            setAuthenticated(true)
            processResponse(schemaMode, data)
        } catch (err: any) {
            const msg = err?.message || 'Failed to fetch schema'
            if (msg.includes('incorrect password') || msg.includes('password verification required')) {
                setAuthError('Incorrect password')
                setAuthenticated(false)
            } else {
                setError(msg)
            }
        } finally {
            setLoading(false)
        }
    }, [password, schemaMode, schoolId, processResponse])

    const handleRefetch = useCallback(async () => {
        if (!password) return
        setLoading(true)
        setError('')
        try {
            const sn = resolveSchemaName()
            if (!sn) return
            const data = await api.post<any>('/super-admin/schema', { password, schema_name: sn })
            processResponse(schemaMode, data)
        } catch (err: any) {
            setError(err?.message || 'Failed to fetch schema')
        } finally {
            setLoading(false)
        }
    }, [password, schemaMode, schoolId, processResponse])

    // noindex
    useEffect(() => {
        const meta = document.createElement('meta')
        meta.name = 'robots'
        meta.content = 'noindex, nofollow'
        document.head.appendChild(meta)
        return () => { document.head.removeChild(meta) }
    }, [])

    // ── Schema selector UI (shared between gate and top bar) ────────────
    const schemaSelectorUI = (isCompact: boolean) => (
        <div className={isCompact ? 'flex items-center gap-2' : 'space-y-4'}>
            <div className={isCompact ? '' : 'space-y-2'}>
                {!isCompact && <label className="text-xs font-medium text-zinc-400">Schema</label>}
                <select
                    value={schemaMode}
                    onChange={e => { setSchemaMode(e.target.value as SchemaMode); setError('') }}
                    className={
                        isCompact
                            ? 'rounded border border-zinc-700 bg-zinc-800 text-zinc-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500'
                            : 'w-full rounded-md border border-zinc-700 bg-zinc-900 text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500'
                    }
                >
                    <option value="public">Public</option>
                    <option value="tenant">Tenant</option>
                    <option value="all">All</option>
                </select>
            </div>

            {schemaMode === 'tenant' && (
                <div className={isCompact ? '' : 'space-y-2'}>
                    {!isCompact && <label className="text-xs font-medium text-zinc-400">School</label>}
                    {schools.length > 0 ? (
                        // Dropdown: name visible, UUID stored as value
                        <select
                            value={schoolId}
                            onChange={e => setSchoolId(e.target.value)}
                            className={
                                isCompact
                                    ? 'rounded border border-zinc-700 bg-zinc-800 text-zinc-300 px-2 py-1 text-xs w-[220px] focus:outline-none focus:ring-1 focus:ring-indigo-500'
                                    : 'w-full rounded-md border border-zinc-700 bg-zinc-900 text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500'
                            }
                        >
                            <option value="">Select a school…</option>
                            {schools.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                    ) : (
                        // Fallback: manual UUID entry
                        <input
                            type="text"
                            value={schoolId}
                            onChange={e => setSchoolId(e.target.value)}
                            placeholder={isCompact ? 'School UUID' : 'e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890'}
                            className={
                                isCompact
                                    ? 'rounded border border-zinc-700 bg-zinc-800 text-zinc-300 px-2 py-1 text-xs w-[280px] font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder:text-zinc-600'
                                    : 'w-full rounded-md border border-zinc-700 bg-zinc-900 text-zinc-100 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-zinc-600'
                            }
                        />
                    )}
                    {/* Always show the resolved UUID so user can confirm which school */}
                    {schoolId && (
                        <p className={isCompact ? 'text-[10px] text-zinc-500 font-mono mt-0.5' : 'text-[11px] text-zinc-500 font-mono mt-1'}>
                            UUID: {schoolId}
                        </p>
                    )}
                </div>
            )}
        </div>
    )

    // ── Gate: password prompt ───────────────────────────────────────────
    if (!authenticated) {
        return (
            <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
                <div className="w-full max-w-sm space-y-6">
                    <div className="text-center space-y-2">
                        <div className="mx-auto w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center">
                            <KeyRound className="h-6 w-6 text-zinc-400" />
                        </div>
                        <h1 className="text-lg font-semibold text-zinc-100">Authentication Required</h1>
                        <p className="text-sm text-zinc-500">Verify your identity to access schema viewer</p>
                    </div>

                    <div className="space-y-4">
                        {schemaSelectorUI(false)}

                        <div className="space-y-2">
                            <label className="text-xs font-medium text-zinc-400">Password</label>
                            <div className="relative">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={e => { setPassword(e.target.value); setAuthError('') }}
                                    onKeyDown={e => e.key === 'Enter' && canFetch() && handleFetch()}
                                    className="w-full rounded-md border border-zinc-700 bg-zinc-900 text-zinc-100 px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    placeholder="Enter your password"
                                    autoFocus
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                                >
                                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                            </div>
                            {authError && <p className="text-xs text-red-400">{authError}</p>}
                        </div>

                        <button
                            onClick={handleFetch}
                            disabled={!canFetch() || loading}
                            className="w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                            Fetch Schema
                        </button>
                    </div>

                    <button
                        onClick={() => router.push('/super-admin')}
                        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 mx-auto"
                    >
                        <ArrowLeft className="h-3 w-3" /> Back to schools
                    </button>
                </div>
            </div>
        )
    }

    // ── Main: schema visualization ──────────────────────────────────────
    return (
        <div className="h-screen w-screen bg-zinc-950 flex flex-col">
            {/* Top bar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur shrink-0">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => router.push('/super-admin')}
                        className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
                    >
                        <ArrowLeft className="h-4 w-4" /> Back
                    </button>
                    <div className="h-5 w-px bg-zinc-700" />
                    <div className="flex items-center gap-2 text-sm text-zinc-300">
                        <Database className="h-4 w-4 text-indigo-400" />
                        <span className="font-mono text-indigo-400">{displayInfo.label}</span>
                        <span className="text-zinc-600">—</span>
                        <span className="text-zinc-500">{displayInfo.tables} tables, {displayInfo.fks} FKs</span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {schemaSelectorUI(true)}
                    <button
                        onClick={handleRefetch}
                        disabled={loading}
                        className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50 flex items-center gap-1.5"
                    >
                        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Database className="h-3 w-3" />}
                        Refetch
                    </button>
                </div>
            </div>

            {error && (
                <div className="px-4 py-2 bg-red-900/40 border-b border-red-800 text-red-300 text-xs">
                    {error}
                </div>
            )}

            {/* React Flow canvas */}
            <div className="flex-1">
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    fitView
                    fitViewOptions={{ padding: 0.15 }}
                    minZoom={0.05}
                    maxZoom={2}
                    proOptions={{ hideAttribution: true }}
                    className="!bg-zinc-950"
                >
                    <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#27272a" />
                    <Controls
                        className="!bg-zinc-800 !border-zinc-700 !shadow-lg [&>button]:!bg-zinc-800 [&>button]:!border-zinc-700 [&>button]:!text-zinc-300 [&>button:hover]:!bg-zinc-700"
                    />
                    <MiniMap
                        nodeColor={(node) => String(node.data?.color ?? '#6366f1')}
                        maskColor="rgba(0,0,0,0.7)"
                        className="!bg-zinc-900 !border-zinc-700"
                    />
                    <SearchPanel />
                    <Panel position="bottom-center">
                        <p className="text-[10px] text-zinc-600">Drag tables to rearrange • Scroll to zoom • {displayInfo.tables} tables loaded</p>
                    </Panel>
                </ReactFlow>
            </div>
        </div>
    )
}
