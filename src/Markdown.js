import { Extension, extensions } from '@tiptap/core';
import { MarkdownTightLists } from "./extensions/tiptap/tight-lists";
import { MarkdownSerializer } from "./serialize/MarkdownSerializer";
import { MarkdownParser } from "./parse/MarkdownParser";
import { MarkdownClipboard } from "./extensions/tiptap/clipboard";
import { cleanupMarkedParser } from "./util/markdown";

// Use WeakRef to track extensions without preventing garbage collection
const activeExtensions = new Set();

// Global cleanup mechanism
let globalCleanupTimer = null;
function scheduleGlobalCleanup() {
    if (globalCleanupTimer) {
        clearTimeout(globalCleanupTimer);
    }
    
    globalCleanupTimer = setTimeout(() => {
        // Run a garbage collection cycle on inactive extensions
        activeExtensions.forEach(weakRef => {
            const extension = weakRef.deref();
            if (!extension || !extension.editor) {
                activeExtensions.delete(weakRef);
            }
        });
        
        // If no extensions remain, clean up global resources
        if (activeExtensions.size === 0) {
            cleanupMarkedParser();
        }
        
        globalCleanupTimer = null;
    }, 30000); // 30 second delay
}

export const Markdown = Extension.create({
    name: 'markdown',
    priority: 50,
    addOptions() {
        return {
            html: true,
            tightLists: true,
            tightListClass: 'tight',
            bulletListMarker: '-',
            linkify: false,
            breaks: false,
            transformPastedText: false,
            transformCopiedText: false,
        }
    },
    addCommands() {
        const commands = extensions.Commands.config.addCommands();
        return {
            setContent: (content, emitUpdate, parseOptions) => (props) => {
                if (!props.editor?.storage?.markdown?.parser) return false;
                
                try {
                    const html = props.editor.storage.markdown.parser.parse(content);
                    return commands.setContent(html, emitUpdate, parseOptions)(props);
                } catch (e) {
                    console.error('Error setting content:', e);
                    return false;
                }
            },
            insertContentAt: (range, content, options) => (props) => {
                if (!props.editor?.storage?.markdown?.parser) return false;
                
                try {
                    const html = props.editor.storage.markdown.parser.parse(content, { inline: true });
                    return commands.insertContentAt(range, html, options)(props);
                } catch (e) {
                    console.error('Error inserting content:', e);
                    return false;
                }
            },
        }
    },
    onBeforeCreate() {
        // Track this extension using WeakRef
        const weakRef = new WeakRef(this);
        activeExtensions.add(weakRef);
        
        // Schedule cleanup periodically
        scheduleGlobalCleanup();
        
        // Set up storage with the parser and serializer
        this.editor.storage.markdown = {
            options: { ...this.options },
            parser: new MarkdownParser(this.editor, this.options),
            serializer: new MarkdownSerializer(this.editor),
            getMarkdown: null, // Will be initialized below
        };
        
        // Define getMarkdown as a function that doesn't capture this
        this.editor.storage.markdown.getMarkdown = () => {
            const editor = this.editor;
            if (!editor?.storage?.markdown?.serializer || !editor.state?.doc) {
                return '';
            }
            
            try {
                return editor.storage.markdown.serializer.serialize(editor.state.doc);
            } catch (e) {
                console.error('Error serializing markdown:', e);
                return '';
            }
        };
        
        // Save initial content and parse it
        this.editor.options.initialContent = this.editor.options.content;
        
        try {
            const parsedContent = this.editor.storage.markdown.parser.parse(this.editor.options.content);
            this.editor.options.content = parsedContent;
        } catch (e) {
            console.error('Error parsing initial content:', e);
            // Keep original content if parsing fails
        }
    },
    onCreate() {
        if (this.editor.options.initialContent !== undefined) {
            this.editor.options.content = this.editor.options.initialContent;
            delete this.editor.options.initialContent;
        }
    },
    onDestroy() {
        // Ensure proper cleanup when the editor is destroyed
        try {
            // Clean up parser if it has a destroy method
            if (this.editor?.storage?.markdown?.parser?.destroy) {
                this.editor.storage.markdown.parser.destroy();
            }
            
            // Clean up references to break potential circular references
            if (this.editor?.storage?.markdown) {
                // Clear each property individually
                if (this.editor.storage.markdown.serializer) {
                    this.editor.storage.markdown.serializer.editor = null;
                    this.editor.storage.markdown.serializer = null;
                }
                
                this.editor.storage.markdown.parser = null;
                this.editor.storage.markdown.getMarkdown = null;
                this.editor.storage.markdown.options = null;
                this.editor.storage.markdown = null;
            }
            
            // Schedule a cleanup to check if all extensions are gone
            scheduleGlobalCleanup();
        } catch (e) {
            console.error('Error during Markdown extension cleanup:', e);
        }
    },
    addStorage() {
        return {
            /// storage will be defined in onBeforeCreate() to prevent initial object overriding
        }
    },
    addExtensions() {
        return [
            MarkdownTightLists.configure({
                tight: this.options.tightLists,
                tightClass: this.options.tightListClass,
            }),
            MarkdownClipboard.configure({
                transformPastedText: this.options.transformPastedText,
                transformCopiedText: this.options.transformCopiedText,
            }),
        ]
    },
});
