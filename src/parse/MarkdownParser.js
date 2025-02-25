import { marked } from 'marked';
import { elementFromString, extractElement, unwrapElement } from "../util/dom";
import { getMarkdownSpec } from "../util/extensions";
import { cleanupMarkedParser } from "../util/markdown";

// Use a weak cache to avoid recomputing selectors
const blockSelectorCache = new WeakMap();

export class MarkdownParser {
    /**
     * @type {import('@tiptap/core').Editor}
     */
    editor = null;
    
    // Track destruction state
    destroyed = false;
    
    // Use a function-based approach instead of storing the parser
    parseMarkdown = null;
    parseMarkdownInline = null;

    constructor(editor, { html, linkify, breaks }) {
        this.editor = editor;
        
        // Configure marked options to match markdown-it behavior
        const markedOptions = {
            headerIds: false, // Don't add IDs to headings
            mangle: false,    // Don't mangle header IDs
            breaks: breaks,   // Line breaks behavior
            gfm: true,        // GitHub Flavored Markdown
            linkify: linkify, // Linkify functionality
            // Handle HTML option explicitly
            html: html !== false, // Allow HTML by default to match markdown-it's default behavior when html=true
            silent: false,
            // In marked, linkify functionality is part of GFM
        };
        
        // Store the parsing functions directly, don't keep a reference to marked
        this.parseMarkdown = this.withPatchedRenderer((text) => {
            // Reset options before each parse to ensure clean state
            marked.setOptions(markedOptions);
            return marked.parse(text);
        });
        
        this.parseMarkdownInline = this.withPatchedRenderer((text) => {
            // Reset options before each parse to ensure clean state
            marked.setOptions(markedOptions);
            return marked.parseInline(text);
        });
        
        // Add event listener for cleanup
        this.destroyHandler = () => this.destroy();
        this.editor.on('destroy', this.destroyHandler);
    }

    /**
     * Cleanup resources to prevent memory leaks
     */
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        
        // Remove event listener
        if (this.editor && this.destroyHandler) {
            this.editor.off('destroy', this.destroyHandler);
            this.destroyHandler = null;
        }
        
        // Release all references
        this.parseMarkdown = null;
        this.parseMarkdownInline = null;
        this.editor = null;
        
        // Clean up the marked parser
        cleanupMarkedParser();
    }

    parse(content, { inline } = {}) {
        if (this.destroyed) return content;
        
        if (typeof content === 'string') {
            try {
                // Call appropriate parse method based on context
                const renderedHTML = inline 
                    ? this.parseMarkdownInline(content)
                    : this.parseMarkdown(content);
                
                // Create DOM from HTML string    
                const element = elementFromString(renderedHTML);
                
                // Allow extensions to modify the DOM
                const extensions = this.editor.extensionManager.extensions;
                for (let i = 0; i < extensions.length; i++) {
                    const extension = extensions[i];
                    const spec = getMarkdownSpec(extension);
                    if (spec?.parse?.updateDOM) {
                        spec.parse.updateDOM.call(
                            { editor: this.editor, options: extension.options }, 
                            element
                        );
                    }
                }
                
                // Normalize the DOM structure
                this.normalizeDOM(element, { inline, content });
                
                // Get HTML and help GC by breaking references
                const result = element.innerHTML;
                
                return result;
            } catch (e) {
                console.error('Error parsing markdown:', e);
                return content;
            }
        }
        
        return content;
    }

    normalizeDOM(node, { inline, content }) {
        if (!node || this.destroyed) return node;
        
        try {
            this.normalizeBlocks(node);
            
            // More efficient query selection with a single querySelectorAll call
            const elements = node.querySelectorAll('*');
            for (let i = 0; i < elements.length; i++) {
                const el = elements[i];
                const nextSibling = el.nextSibling;
                if (nextSibling?.nodeType === Node.TEXT_NODE && !el.closest('pre')) {
                    nextSibling.textContent = nextSibling.textContent.replace(/^\n/, '');
                }
            }
            
            if (inline) {
                this.normalizeInline(node, content);
            }
            
            return node;
        } catch (e) {
            console.error('Error normalizing DOM:', e);
            return node;
        }
    }

    normalizeBlocks(node) {
        // Use cached selector for better performance
        let selector = null;
        
        if (!blockSelectorCache.has(this.editor.schema)) {
            const blocks = Object.values(this.editor.schema.nodes)
                .filter(node => node.isBlock);
                
            selector = blocks
                .map(block => block.spec.parseDOM?.map(spec => spec.tag))
                .flat()
                .filter(Boolean)
                .join(',');
                
            // Cache the selector for future use
            blockSelectorCache.set(this.editor.schema, selector);
        } else {
            selector = blockSelectorCache.get(this.editor.schema);
        }
        
        if (!selector) {
            return;
        }
        
        // Use a more memory-efficient approach by avoiding array creation
        const elements = node.querySelectorAll(selector);
        for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            if (el.parentElement?.matches('p')) {
                extractElement(el);
            }
        }
    }

    normalizeInline(node, content) {
        if (node.firstElementChild?.matches('p')) {
            const firstParagraph = node.firstElementChild;
            const nextElementSibling = firstParagraph.nextElementSibling;
            
            // Optimize regex operations
            let startSpaces = '';
            let endSpaces = '';
            
            const startMatch = /^\s+/.exec(content);
            if (startMatch) startSpaces = startMatch[0];
            
            if (!nextElementSibling) {
                const endMatch = /\s+$/.exec(content);
                if (endMatch) endSpaces = endMatch[0];
            }
            
            if (/^\n\n/.test(content)) {
                firstParagraph.innerHTML = `${firstParagraph.innerHTML}${endSpaces}`;
                return;
            }
            
            unwrapElement(firstParagraph);
            
            node.innerHTML = `${startSpaces}${node.innerHTML}${endSpaces}`;
        }
    }

    /**
     * Patch the renderer to handle newlines correctly
     */
    withPatchedRenderer(renderFn) {
        return (text) => {
            try {
                const rendered = renderFn(text);
                
                // Don't modify soft breaks
                if (rendered === '\n') {
                    return rendered;
                }
                
                // Remove trailing newlines
                if (rendered.endsWith('\n')) {
                    return rendered.slice(0, -1);
                }
                
                return rendered;
            } catch (e) {
                console.error('Error in renderer:', e);
                // Return original text as fallback
                return text;
            }
        };
    }
}

