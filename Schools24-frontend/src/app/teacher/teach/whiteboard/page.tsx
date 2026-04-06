"use client"

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import {
    Pen,
    Eraser,
    Square,
    Circle,
    Type,
    Minus,
    Undo,
    Redo,
    Trash2,
    Download,
    ZoomIn,
    ZoomOut,
    ArrowLeft,
    Maximize,
    Minimize,
} from 'lucide-react'
import Link from 'next/link'

const tools = [
    { id: 'pen', icon: <Pen className="h-4 w-4" />, label: 'Pen' },
    { id: 'eraser', icon: <Eraser className="h-4 w-4" />, label: 'Eraser' },
    { id: 'line', icon: <Minus className="h-4 w-4" />, label: 'Line' },
    { id: 'rectangle', icon: <Square className="h-4 w-4" />, label: 'Rectangle' },
    { id: 'circle', icon: <Circle className="h-4 w-4" />, label: 'Circle' },
    { id: 'text', icon: <Type className="h-4 w-4" />, label: 'Text' },
]

const colors = ['#000000', '#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#ffffff']

export default function WhiteboardPage() {
    // Refs
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const whiteboardRef = useRef<HTMLDivElement>(null)

    // State
    const [isDrawing, setIsDrawing] = useState(false)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null)
    const [snapshot, setSnapshot] = useState<ImageData | null>(null)
    const [history, setHistory] = useState<ImageData[]>([])
    const [historyStep, setHistoryStep] = useState(-1)
    const [canvasMetrics, setCanvasMetrics] = useState({ width: 1, height: 1 })

    // Refs for state access in event listeners
    const historyRef = useRef<ImageData[]>([])
    const historyStepRef = useRef<number>(-1)

    // Tools State
    const [activeTool, setActiveTool] = useState('pen')
    const [activeColor, setActiveColor] = useState('#000000')
    const [strokeWidth, setStrokeWidth] = useState(3)
    const [zoom, setZoom] = useState(1)

    // Text Input State
    const [textInput, setTextInput] = useState<{ x: number; y: number; text: string } | null>(null)

    // Fullscreen toggle function
    const toggleFullscreen = useCallback(async () => {
        if (!whiteboardRef.current) return

        if (!document.fullscreenElement) {
            try {
                await whiteboardRef.current.requestFullscreen()
                setIsFullscreen(true)
            } catch (err) {
                console.error('Error entering fullscreen:', err)
            }
        } else {
            try {
                await document.exitFullscreen()
                setIsFullscreen(false)
            } catch (err) {
                console.error('Error exiting fullscreen:', err)
            }
        }
    }, [])

    // Listen for fullscreen changes
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement)
        }

        document.addEventListener('fullscreenchange', handleFullscreenChange)
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }, [])

    // Sync refs
    useEffect(() => {
        historyRef.current = history
        historyStepRef.current = historyStep
    }, [history, historyStep])

    // Initialize Canvas
    useEffect(() => {
        const canvas = canvasRef.current
        const container = containerRef.current
        if (!canvas || !container) return

        const resizeCanvas = () => {
            // Save current content temporarily
            const tempCanvas = document.createElement('canvas')
            const tempCtx = tempCanvas.getContext('2d')
            tempCanvas.width = canvas.width
            tempCanvas.height = canvas.height
            tempCtx?.drawImage(canvas, 0, 0)

            // Resize
            canvas.width = container.offsetWidth
            canvas.height = container.offsetHeight
            setCanvasMetrics({ width: canvas.width, height: canvas.height })

            // Fill with white background
            const ctx = canvas.getContext('2d')
            if (ctx) {
                ctx.fillStyle = '#ffffff'
                ctx.fillRect(0, 0, canvas.width, canvas.height)
                ctx.lineCap = 'round'
                ctx.lineJoin = 'round'

                const curStep = historyStepRef.current
                const curHist = historyRef.current

                if (curStep >= 0 && curHist[curStep]) {
                    ctx.putImageData(curHist[curStep], 0, 0)
                }
            }
        }

        // Initial set
        canvas.width = container.offsetWidth
        canvas.height = container.offsetHeight
        setCanvasMetrics({ width: canvas.width, height: canvas.height })

        // Initial history save setup
        const ctx = canvas.getContext('2d')
        if (ctx) {
            // Fill with white background initially
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(0, 0, canvas.width, canvas.height)
            ctx.lineCap = 'round'
            ctx.lineJoin = 'round'

            if (historyRef.current.length === 0) {
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
                setHistory([imageData])
                setHistoryStep(0)
            }
        }

        window.addEventListener('resize', resizeCanvas)
        return () => window.removeEventListener('resize', resizeCanvas)
    }, [])

    // Helpers - Get position for both mouse and touch events
    const getEventPos = useCallback((e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) => {
        const canvas = canvasRef.current
        if (!canvas) return { x: 0, y: 0 }
        const rect = canvas.getBoundingClientRect()

        let clientX: number, clientY: number

        if ('touches' in e) {
            if (e.touches.length > 0) {
                clientX = e.touches[0].clientX
                clientY = e.touches[0].clientY
            } else if (e.changedTouches.length > 0) {
                clientX = e.changedTouches[0].clientX
                clientY = e.changedTouches[0].clientY
            } else {
                return { x: 0, y: 0 }
            }
        } else {
            clientX = e.clientX
            clientY = e.clientY
        }

        // Account for zoom when calculating position
        const scaleX = canvas.width / rect.width
        const scaleY = canvas.height / rect.height

        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        }
    }, [])

    const saveHistory = useCallback(() => {
        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx) return

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        setHistory(prev => {
            const newHistory = prev.slice(0, historyStepRef.current + 1)
            newHistory.push(imageData)
            return newHistory
        })
        setHistoryStep(prev => prev + 1)
    }, [])

    const undo = useCallback(() => {
        if (historyStepRef.current > 0) {
            const newStep = historyStepRef.current - 1
            setHistoryStep(newStep)
            const ctx = canvasRef.current?.getContext('2d')
            if (ctx && historyRef.current[newStep]) {
                ctx.putImageData(historyRef.current[newStep], 0, 0)
            }
        }
    }, [])

    const redo = useCallback(() => {
        if (historyStepRef.current < historyRef.current.length - 1) {
            const newStep = historyStepRef.current + 1
            setHistoryStep(newStep)
            const ctx = canvasRef.current?.getContext('2d')
            if (ctx && historyRef.current[newStep]) {
                ctx.putImageData(historyRef.current[newStep], 0, 0)
            }
        }
    }, [])

    const clearCanvas = useCallback(() => {
        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx) return

        // Fill with white instead of just clearing
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        saveHistory()
    }, [saveHistory])

    const resetZoom = useCallback(() => {
        setZoom(1)
    }, [])

    const handleDownload = useCallback(() => {
        const canvas = canvasRef.current
        if (!canvas) return

        const link = document.createElement('a')
        link.download = `whiteboard-${new Date().toISOString().slice(0, 10)}.png`
        link.href = canvas.toDataURL('image/png')
        link.click()
    }, [])

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'z') {
                    e.preventDefault()
                    if (e.shiftKey) {
                        redo()
                    } else {
                        undo()
                    }
                } else if (e.key === 'y') {
                    e.preventDefault()
                    redo()
                } else if (e.key === 's') {
                    e.preventDefault()
                    handleDownload()
                }
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [undo, redo, handleDownload])

    // Drawing Logic
    const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
        e.preventDefault()

        if (activeTool === 'text') {
            const { x, y } = getEventPos(e)
            setTextInput({ x, y, text: '' })
            return
        }

        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx) return

        setIsDrawing(true)
        const { x, y } = getEventPos(e)
        setStartPos({ x, y })
        setSnapshot(ctx.getImageData(0, 0, canvas.width, canvas.height))

        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.strokeStyle = activeTool === 'eraser' ? '#ffffff' : activeColor
        ctx.lineWidth = activeTool === 'eraser' ? strokeWidth * 3 : strokeWidth
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
    }

    const draw = (e: React.MouseEvent | React.TouchEvent) => {
        e.preventDefault()
        if (!isDrawing || !startPos) return

        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx) return

        const { x, y } = getEventPos(e)

        if (activeTool === 'pen') {
            ctx.globalCompositeOperation = 'source-over'
            ctx.strokeStyle = activeColor
            ctx.lineWidth = strokeWidth
            ctx.lineTo(x, y)
            ctx.stroke()
        } else if (activeTool === 'eraser') {
            // Use white color for eraser to maintain white background
            ctx.globalCompositeOperation = 'source-over'
            ctx.strokeStyle = '#ffffff'
            ctx.lineWidth = strokeWidth * 3
            ctx.lineTo(x, y)
            ctx.stroke()
        } else if (snapshot) {
            // Shapes: Restore snapshot first (preview)
            ctx.putImageData(snapshot, 0, 0)
            ctx.globalCompositeOperation = 'source-over'
            ctx.beginPath()
            ctx.strokeStyle = activeColor
            ctx.lineWidth = strokeWidth

            if (activeTool === 'line') {
                ctx.moveTo(startPos.x, startPos.y)
                ctx.lineTo(x, y)
            } else if (activeTool === 'rectangle') {
                ctx.rect(startPos.x, startPos.y, x - startPos.x, y - startPos.y)
            } else if (activeTool === 'circle') {
                const radius = Math.sqrt(Math.pow(x - startPos.x, 2) + Math.pow(y - startPos.y, 2))
                ctx.arc(startPos.x, startPos.y, radius, 0, 2 * Math.PI)
            }

            ctx.stroke()
        }
    }

    const stopDrawing = (e?: React.MouseEvent | React.TouchEvent) => {
        if (e) e.preventDefault()

        if (isDrawing) {
            setIsDrawing(false)
            setStartPos(null)
            setSnapshot(null)
            const ctx = canvasRef.current?.getContext('2d')
            if (ctx) {
                ctx.globalCompositeOperation = 'source-over'
                ctx.beginPath()
                saveHistory()
            }
        }
    }

    // Text Logic
    const handleTextComplete = () => {
        if (!textInput || !textInput.text.trim()) {
            setTextInput(null)
            return
        }

        const ctx = canvasRef.current?.getContext('2d')
        if (ctx) {
            ctx.font = `${strokeWidth * 4 + 12}px sans-serif`
            ctx.fillStyle = activeColor
            ctx.fillText(textInput.text, textInput.x, textInput.y + (strokeWidth * 4 + 12))
            saveHistory()
        }
        setTextInput(null)
    }

    // Get cursor style based on active tool
    const getCursorStyle = () => {
        switch (activeTool) {
            case 'eraser':
                return 'crosshair'
            case 'text':
                return 'text'
            default:
                return 'crosshair'
        }
    }

    return (
        <div
            ref={whiteboardRef}
            className={`flex flex-col bg-background ${isFullscreen ? 'h-screen' : 'h-[calc(100vh-6rem)] md:h-[calc(100vh-8rem)]'}`}
        >
            {/* Toolbar */}
            <div className={`flex flex-wrap items-center justify-between p-2 sm:p-4 border-b bg-card gap-2 sm:gap-4 ${isFullscreen ? 'bg-card/95 backdrop-blur-sm shadow-lg' : ''}` }>
                <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                    {!isFullscreen && (
                        <Link href="/teacher/teach">
                            <Button variant="ghost" size="sm">
                                <ArrowLeft className="mr-2 h-4 w-4" />
                                Back
                            </Button>
                        </Link>
                    )}
                    {!isFullscreen && <div className="h-6 w-px bg-border hidden md:block" />}

                    {/* Tools */}
                    <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-lg">
                        {tools.map((tool) => (
                            <Button
                                key={tool.id}
                                variant={activeTool === tool.id ? 'default' : 'ghost'}
                                size="icon"
                                onClick={() => setActiveTool(tool.id)}
                                title={tool.label}
                                className="h-8 w-8"
                            >
                                {tool.icon}
                            </Button>
                        ))}
                    </div>

                    <div className="h-6 w-px bg-border hidden md:block" />

                    {/* Colors */}
                    <div className="flex items-center gap-1.5 bg-muted/50 p-1 rounded-lg">
                        {colors.map((color) => (
                            <button
                                key={color}
                                className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${activeColor === color ? 'border-primary ring-2 ring-primary ring-offset-2' : 'border-transparent'
                                    }`}
                                style={{ backgroundColor: color, boxShadow: color === '#ffffff' ? 'inset 0 0 0 1px #e5e7eb' : 'none' }}
                                onClick={() => setActiveColor(color)}
                                title={color === '#ffffff' ? 'White' : color}
                            />
                        ))}
                    </div>

                    <div className="h-6 w-px bg-border hidden md:block" />

                    {/* Stroke Width */}
                    <div className="flex items-center gap-2 bg-muted/50 p-1 px-3 rounded-lg">
                        <span className="text-xs text-muted-foreground uppercase font-bold">Size</span>
                        <input
                            type="range"
                            min="1"
                            max="20"
                            value={strokeWidth}
                            onChange={(e) => setStrokeWidth(parseInt(e.target.value))}
                            className="w-24 h-2 bg-muted-foreground/20 rounded-lg appearance-none cursor-pointer accent-primary"
                        />
                        <span className="text-xs w-6 font-mono font-medium">{strokeWidth}px</span>
                    </div>
                </div>

                <div className="flex w-full sm:w-auto items-center gap-2 bg-muted/50 p-1 rounded-lg overflow-x-auto">
                    <Button
                        variant="ghost"
                        size="icon"
                        title="Undo (Ctrl+Z)"
                        onClick={undo}
                        disabled={historyStep <= 0}
                        className="h-8 w-8"
                    >
                        <Undo className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        title="Redo (Ctrl+Y)"
                        onClick={redo}
                        disabled={historyStep >= history.length - 1}
                        className="h-8 w-8"
                    >
                        <Redo className="h-4 w-4" />
                    </Button>
                    <div className="h-6 w-px bg-border" />
                    <Button
                        variant="ghost"
                        size="icon"
                        title="Zoom In"
                        onClick={() => setZoom(z => Math.min(z + 0.25, 3))}
                        className="h-8 w-8"
                    >
                        <ZoomIn className="h-4 w-4" />
                    </Button>
                    <button
                        onClick={resetZoom}
                        className="text-xs font-mono w-12 text-center hover:bg-muted rounded px-1 py-0.5 transition-colors"
                        title="Reset Zoom"
                    >
                        {Math.round(zoom * 100)}%
                    </button>
                    <Button
                        variant="ghost"
                        size="icon"
                        title="Zoom Out"
                        onClick={() => setZoom(z => Math.max(z - 0.25, 0.25))}
                        className="h-8 w-8"
                    >
                        <ZoomOut className="h-4 w-4" />
                    </Button>
                    <div className="h-6 w-px bg-border" />
                    <Button
                        variant="ghost"
                        size="icon"
                        title="Clear Canvas"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8"
                        onClick={clearCanvas}
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                    <div className="h-6 w-px bg-border" />
                    {/* Fullscreen Button */}
                    <Button
                        variant="ghost"
                        size="icon"
                        title={isFullscreen ? "Exit Fullscreen (Esc)" : "Fullscreen"}
                        onClick={toggleFullscreen}
                        className="hover:bg-primary/10 hover:text-primary h-8 w-8"
                    >
                        {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleDownload} title="Save (Ctrl+S)">
                        <Download className="mr-2 h-4 w-4" />
                        Save
                    </Button>
                </div>
            </div>

            {/* Canvas Area - Pure White Background, Stretchable */}
            <div
                className="flex-1 bg-neutral-100 relative overflow-auto"
                ref={containerRef}
            >
                <div
                    className="relative bg-white shadow-lg"
                    style={{
                        transform: `scale(${zoom})`,
                        transformOrigin: 'top left',
                        width: '100%',
                        height: '100%',
                    }}
                >
                    {/* Drawing Canvas */}
                    <canvas
                        ref={canvasRef}
                        onMouseDown={startDrawing}
                        onMouseMove={draw}
                        onMouseUp={stopDrawing}
                        onMouseLeave={stopDrawing}
                        onTouchStart={startDrawing}
                        onTouchMove={draw}
                        onTouchEnd={stopDrawing}
                        onTouchCancel={stopDrawing}
                        className="w-full h-full relative z-10 touch-none"
                        style={{
                            cursor: getCursorStyle(),
                            backgroundColor: '#ffffff'
                        }}
                    />

                    {/* Text Input Overlay */}
                    {textInput && (
                        <div
                            className="absolute"
                            style={{
                                left: (textInput.x / canvasMetrics.width) * 100 + '%',
                                top: (textInput.y / canvasMetrics.height) * 100 + '%',
                                transform: `translate(0, -50%) scale(${1 / zoom})`,
                                transformOrigin: 'top left',
                                zIndex: 20
                            }}
                        >
                            <input
                                autoFocus
                                className="border border-primary/50 outline-none p-2 rounded min-w-[140px] sm:min-w-[200px] max-w-[80vw] shadow-lg bg-white"
                                style={{
                                    fontSize: `${strokeWidth * 4 + 12}px`,
                                    color: activeColor
                                }}
                                value={textInput.text}
                                onChange={(e) => setTextInput({ ...textInput, text: e.target.value })}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleTextComplete()
                                    if (e.key === 'Escape') setTextInput(null)
                                }}
                                onBlur={handleTextComplete}
                                placeholder="Type here..."
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
