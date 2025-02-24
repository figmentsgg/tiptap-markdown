import { Node } from "@tiptap/core";


const CodeBlock = Node.create({
    name: 'codeBlock',
});

export default CodeBlock.extend({
    /**
     * @return {{markdown: MarkdownNodeSpec}}
     */
    addStorage() {
        return {
            markdown: {
                serialize(state, node) {
                    state.write("```" + (node.attrs.language || "") + "\n");
                    state.text(node.textContent, false);
                    state.ensureNewLine();
                    state.write("```");
                    state.closeBlock(node);
                },
                parse: {
                    setup(marked) {
                        // Set the language class prefix if needed
                        // This maintains the same behavior as in markdown-it
                        // Marked uses 'language-' prefix by default like markdown-it
                        const langPrefix = this.options.languageClassPrefix ?? 'language-';
                        if (langPrefix !== 'language-') {
                            marked.setOptions({ langPrefix });
                        }
                    },
                    updateDOM(element) {
                        element.innerHTML = element.innerHTML.replace(/\n<\/code><\/pre>/g, '</code></pre>')
                    },
                },
            }
        }
    }
});
