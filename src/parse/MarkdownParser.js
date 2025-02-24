import { marked } from 'marked';
import { elementFromString, extractElement, unwrapElement } from "../util/dom";
import { getMarkdownSpec } from "../util/extensions";

export class MarkdownParser {
    /**
     * @type {import('@tiptap/core').Editor}
     */
    editor = null;
    /**
     * @type {marked}
     */
    marked = null;

    constructor(editor, { html, linkify, breaks }) {
        this.editor = editor;
        
        // Configure marked options to match markdown-it behavior
        marked.setOptions({
            headerIds: false, // Don't add IDs to headings
            mangle: false,    // Don't mangle header IDs
            breaks: breaks,   // Line breaks behavior
            gfm: true,        // GitHub Flavored Markdown
            // Handle HTML option explicitly
            html: html !== false, // Allow HTML by default to match markdown-it's default behavior when html=true
            silent: false,
            // In marked, linkify functionality is part of GFM
            // But we can't separately control it like in markdown-it
        });
        
        this.marked = {
            parse: this.withPatchedRenderer(marked.parse),
            parseInline: this.withPatchedRenderer(marked.parseInline)
        };
    }

    /**
     * Cleanup resources to prevent memory leaks
     */
    destroy() {
        // Release references that could cause memory leaks
        this.marked = null;
        this.editor = null;
    }

    parse(content, { inline } = {}) {
        if(typeof content === 'string') {
            // Allow extensions to modify the parser
            this.editor.extensionManager.extensions.forEach(extension =>
                getMarkdownSpec(extension)?.parse?.setup?.call({ editor:this.editor, options:extension.options }, marked)
            );

            // Parse markdown to HTML - use appropriate method based on context
            const renderedHTML = inline 
                ? this.marked.parseInline(content)
                : this.marked.parse(content);
                
            const element = elementFromString(renderedHTML);

            // Allow extensions to modify the DOM
            this.editor.extensionManager.extensions.forEach(extension =>
                getMarkdownSpec(extension)?.parse?.updateDOM?.call({ editor:this.editor, options:extension.options }, element)
            );

            this.normalizeDOM(element, { inline, content });

            return element.innerHTML;
        }

        return content;
    }

    normalizeDOM(node, { inline, content }) {
        this.normalizeBlocks(node);

        // Remove trailing newlines from elements
        node.querySelectorAll('*').forEach(el => {
            if(el.nextSibling?.nodeType === Node.TEXT_NODE && !el.closest('pre')) {
                el.nextSibling.textContent = el.nextSibling.textContent.replace(/^\n/, '');
            }
        });

        if(inline) {
            this.normalizeInline(node, content);
        }

        return node;
    }

    normalizeBlocks(node) {
        const blocks = Object.values(this.editor.schema.nodes)
            .filter(node => node.isBlock);

        const selector = blocks
            .map(block => block.spec.parseDOM?.map(spec => spec.tag))
            .flat()
            .filter(Boolean)
            .join(',');

        if(!selector) {
            return;
        }

        [...node.querySelectorAll(selector)].forEach(el => {
            if(el.parentElement.matches('p')) {
                extractElement(el);
            }
        });
    }

    normalizeInline(node, content) {
        if(node.firstElementChild?.matches('p')) {
            const firstParagraph = node.firstElementChild;
            const { nextElementSibling } = firstParagraph;
            const startSpaces = content.match(/^\s+/)?.[0] ?? '';
            const endSpaces = !nextElementSibling
                ? content.match(/\s+$/)?.[0] ?? ''
                : '';

            if(content.match(/^\n\n/)) {
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
        };
    }
}

