// Quill.js interop for RichTextEditor component
// Handles editor initialization, events, and content management

const editorStates = new Map();
const softBreakBlotName = 'softbreak';
const softBreakPlaceholderAttribute = 'data-bb-softbreak';
const blockTags = new Set([
    'article', 'aside', 'blockquote', 'div', 'figcaption', 'figure', 'footer',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'li', 'main', 'ol', 'p',
    'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul'
]);
const voidTags = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
    'meta', 'param', 'source', 'track', 'wbr'
]);
let softBreakRegistered = false;

function registerSoftBreakBlot() {
    if (softBreakRegistered) return true;

    const QuillConstructor = globalThis.Quill;
    if (!QuillConstructor) return false;

    if (QuillConstructor.imports?.[`formats/${softBreakBlotName}`]) {
        softBreakRegistered = true;
        return true;
    }

    const parchment = QuillConstructor.import('parchment');
    if (!parchment?.EmbedBlot) return false;

    class SoftBreak extends parchment.EmbedBlot {
        static blotName = softBreakBlotName;
        static tagName = 'BR';
        static scope = parchment.Scope.INLINE_BLOT;

        static value() {
            return true;
        }

        value() {
            return true;
        }
    }

    QuillConstructor.register(SoftBreak, true);
    softBreakRegistered = true;
    return true;
}

function insertSoftBreak(quill, range) {
    if (!range || !quill.scroll?.query?.(softBreakBlotName)) return false;

    quill.history?.cutoff();
    if (range.length > 0) {
        quill.deleteText(range.index, range.length, 'user');
    }

    quill.insertEmbed(range.index, softBreakBlotName, true, 'user');
    quill.setSelection(range.index + 1, 0, 'silent');
    quill.history?.cutoff();
    return false;
}

function attachClipboardMatchers(quill, options) {
    const Delta = globalThis.Quill.import('delta');

    if (options.normalizePastedText) {
        quill.clipboard.addMatcher(Node.TEXT_NODE, node => {
            return new Delta().insert(normalizeText(node.data));
        });
    }

    if (options.enableSoftBreaks) {
        quill.clipboard.addMatcher('BR', () => {
            return new Delta().insert({ [softBreakBlotName]: true });
        });
        quill.clipboard.addMatcher(`span[${softBreakPlaceholderAttribute}]`, () => {
            return new Delta().insert({ [softBreakBlotName]: true });
        });
    }
}

function getEditorHtml(stored) {
    if (stored.options.enableSoftBreaks) {
        return normalizeHtml(stored.quill.root.innerHTML);
    }

    return typeof stored.quill.getSemanticHTML === 'function'
        ? stored.quill.getSemanticHTML()
        : stored.quill.root.innerHTML;
}

function normalizeText(text) {
    return (text || '').replace(/\u00a0/g, ' ');
}

function normalizeDom(node) {
    if (node.nodeType === Node.TEXT_NODE) {
        node.nodeValue = normalizeText(node.nodeValue);
        return;
    }

    for (const child of Array.from(node.childNodes)) {
        normalizeDom(child);
    }

    removeLayoutWhitespace(node);
}

function parseHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html || '';
    normalizeDom(template.content);
    return template.content;
}

function removeLayoutWhitespace(node) {
    if (!node.childNodes?.length) return;

    const children = Array.from(node.childNodes);
    const parentIsFragment = node.nodeType === Node.DOCUMENT_FRAGMENT_NODE;
    const hasBlockChild = children.some(isBlockNode);
    if (!parentIsFragment && !hasBlockChild) return;

    for (const child of children) {
        if (isWhitespaceTextNode(child)) child.remove();
    }
}

function isBlockNode(node) {
    return node.nodeType === Node.ELEMENT_NODE && blockTags.has(node.tagName.toLowerCase());
}

function isWhitespaceTextNode(node) {
    return node.nodeType === Node.TEXT_NODE && normalizeText(node.nodeValue).trim().length === 0;
}

function normalizeHtml(html) {
    return Array.from(parseHtml(html).childNodes).map(serializeInline).join('');
}

function replaceSoftBreaksWithPlaceholders(html) {
    const fragment = parseHtml(html);
    for (const br of Array.from(fragment.querySelectorAll('br'))) {
        const placeholder = document.createElement('span');
        placeholder.setAttribute(softBreakPlaceholderAttribute, 'true');
        br.replaceWith(placeholder);
    }

    return Array.from(fragment.childNodes).map(serializeInline).join('');
}

function serializeInline(node) {
    if (node.nodeType === Node.TEXT_NODE) return escapeText(normalizeText(node.nodeValue));
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();
    const open = `<${tag}${serializeAttributes(node)}>`;
    if (voidTags.has(tag)) return open;

    return `${open}${Array.from(node.childNodes).map(serializeInline).join('')}</${tag}>`;
}

function serializeAttributes(element) {
    return Array.from(element.attributes)
        .map(attribute => ` ${attribute.name}="${escapeAttribute(attribute.value)}"`)
        .join('');
}

function escapeText(value) {
    return (value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeAttribute(value) {
    return escapeText(value).replace(/"/g, '&quot;');
}

/**
 * Initializes a Quill editor instance
 * @param {HTMLElement} element - The editor container element
 * @param {DotNetObject} dotNetRef - Reference to the Blazor component
 * @param {string} editorId - Unique identifier for the editor
 * @param {Object} options - Editor configuration options
 */
export function initializeEditor(element, dotNetRef, editorId, options) {
    if (!element || !dotNetRef) {
        console.error('initializeEditor: missing required parameters');
        return;
    }

    if (typeof globalThis.Quill === 'undefined') {
        console.error('Quill is not loaded. Please include Quill.js in your page.');
        return;
    }

    const normalizedOptions = {
        placeholder: options?.placeholder || '',
        readOnly: options?.readOnly || false,
        enableSoftBreaks: options?.enableSoftBreaks === true,
        normalizePastedText: options?.normalizePastedText === true
    };
    if (normalizedOptions.enableSoftBreaks && !registerSoftBreakBlot()) {
        console.error('Unable to register the Quill soft-break format.');
        return;
    }

    const formats = [
        'bold', 'italic', 'underline', 'strike',
        'header',
        'list',
        'blockquote', 'code-block',
        'link',
        'indent'
    ];
    const modules = {
        toolbar: false
    };
    if (normalizedOptions.enableSoftBreaks) {
        formats.push(softBreakBlotName);
        modules.keyboard = {
            bindings: {
                softBreak: {
                    key: 'Enter',
                    shiftKey: true,
                    handler(range) {
                        return insertSoftBreak(this.quill, range);
                    }
                }
            }
        };
    }

    const quillOptions = {
        theme: null,  // Headless mode - we handle the toolbar ourselves
        placeholder: normalizedOptions.placeholder,
        readOnly: normalizedOptions.readOnly,
        modules,
        formats
    };

    const quill = new globalThis.Quill(element, quillOptions);
    attachClipboardMatchers(quill, normalizedOptions);

    const state = {
        quill,
        dotNetRef,
        options: normalizedOptions,
        textChangeTimeout: null,
        textChangeHandler: null,
        selectionChangeHandler: null
    };

    // Debounced text-change handler
    const textChangeHandler = (delta, oldDelta, source) => {
        clearTimeout(state.textChangeTimeout);
        state.textChangeTimeout = setTimeout(() => {
            if (editorStates.get(editorId) !== state) return;
            dotNetRef.invokeMethodAsync('OnTextChangeCallback', {
                delta: JSON.stringify(delta),
                oldDelta: JSON.stringify(oldDelta),
                source: source,
                html: getEditorHtml(state),
                text: quill.getText(),
                length: quill.getLength()
            }).catch(err => console.error('Error in text-change:', err));
        }, 150);
    };
    state.textChangeHandler = textChangeHandler;
    quill.on('text-change', textChangeHandler);

    // Selection-change for focus/blur detection and format tracking
    const selectionChangeHandler = (range, oldRange, source) => {
        const format = range ? quill.getFormat(range) : {};
        dotNetRef.invokeMethodAsync('OnSelectionChangeCallback', {
            range: range,
            oldRange: oldRange,
            source: source,
            format: format
        }).catch(err => console.error('Error in selection-change:', err));
    };
    state.selectionChangeHandler = selectionChangeHandler;
    quill.on('selection-change', selectionChangeHandler);

    editorStates.set(editorId, state);
}

/**
 * Disposes of an editor instance
 * @param {string} editorId - Unique identifier for the editor
 */
export function disposeEditor(editorId) {
    const stored = editorStates.get(editorId);
    if (stored) {
        // Clear pending debounce timeout
        if (stored.textChangeTimeout) {
            clearTimeout(stored.textChangeTimeout);
            stored.textChangeTimeout = null;
        }

        // Remove event handlers to prevent memory leaks
        stored.quill.off('text-change', stored.textChangeHandler);
        stored.quill.off('selection-change', stored.selectionChangeHandler);

        editorStates.delete(editorId);
    }
}

/**
 * Sets the HTML content of the editor
 * Uses Quill's clipboard module to properly convert HTML to Delta,
 * maintaining synchronization between DOM and internal state.
 * Suppresses callbacks to prevent update loops during programmatic updates.
 * @param {string} editorId - Unique identifier for the editor
 * @param {string} html - HTML content to set
 */
export function setHtml(editorId, html) {
    const stored = editorStates.get(editorId);
    if (stored) {
        const quill = stored.quill;

        if (!html) {
            quill.setContents([{ insert: '\n' }], 'silent');
        } else {
            const convertedHtml = stored.options.enableSoftBreaks
                ? replaceSoftBreaksWithPlaceholders(html)
                : html;
            const delta = quill.clipboard.convert({ html: convertedHtml });
            quill.setContents(delta, 'silent');
        }
    }
}

/**
 * Gets the HTML content of the editor using Quill's semantic HTML output
 * Uses getSemanticHTML() for normalized, consistent HTML across browsers
 * @param {string} editorId - Unique identifier for the editor
 * @returns {string} HTML content
 */
export function getHtml(editorId) {
    const stored = editorStates.get(editorId);
    return stored ? getEditorHtml(stored) : '';
}

/**
 * Sets the editor contents using a Delta object
 * Suppresses callbacks to prevent update loops during programmatic updates.
 * @param {string} editorId - Unique identifier for the editor
 * @param {string} delta - JSON string representation of the Delta
 */
export function setContents(editorId, delta) {
    const stored = editorStates.get(editorId);
    if (stored && delta) {
        stored.quill.setContents(JSON.parse(delta), 'silent');
    }
}

/**
 * Gets the editor contents as a Delta object
 * @param {string} editorId - Unique identifier for the editor
 * @returns {string} JSON string representation of the Delta
 */
export function getContents(editorId) {
    const stored = editorStates.get(editorId);
    if (stored) {
        return JSON.stringify(stored.quill.getContents());
    }
    return '{}';
}

/**
 * Gets the plain text content of the editor
 * @param {string} editorId - Unique identifier for the editor
 * @returns {string} Plain text content
 */
export function getText(editorId) {
    const stored = editorStates.get(editorId);
    if (stored) {
        return stored.quill.getText();
    }
    return '';
}

/**
 * Gets the length of the editor content
 * @param {string} editorId - Unique identifier for the editor
 * @returns {number} Content length
 */
export function getLength(editorId) {
    const stored = editorStates.get(editorId);
    if (stored) {
        return stored.quill.getLength();
    }
    return 0;
}

/**
 * Gets the current selection range
 * @param {string} editorId - Unique identifier for the editor
 * @returns {Object|null} Selection range with index and length, or null
 */
export function getSelection(editorId) {
    const stored = editorStates.get(editorId);
    if (stored) {
        return stored.quill.getSelection();
    }
    return null;
}

/**
 * Sets the selection range
 * @param {string} editorId - Unique identifier for the editor
 * @param {number} index - Start index
 * @param {number} length - Selection length
 */
export function setSelection(editorId, index, length) {
    const stored = editorStates.get(editorId);
    if (stored) {
        stored.quill.setSelection(index, length);
    }
}

/**
 * Applies formatting to the current selection
 * @param {string} editorId - Unique identifier for the editor
 * @param {string} formatName - Name of the format
 * @param {*} value - Format value
 */
export function format(editorId, formatName, value) {
    const stored = editorStates.get(editorId);
    if (stored) {
        stored.quill.format(formatName, value);
    }
}

/**
 * Applies formatting and returns the updated format state
 * Used for all formats to ensure immediate state sync
 * @param {string} editorId - Unique identifier for the editor
 * @param {string} formatName - Name of the format
 * @param {*} value - Format value
 * @returns {Object} Updated format state
 */
export function formatAndGetState(editorId, formatName, value) {
    const stored = editorStates.get(editorId);
    if (stored) {
        const quill = stored.quill;
        const range = quill.getSelection();

        // Special handling for block format removal in Quill v2
        // Quill's format('code-block', false) and format('blockquote', false) don't work correctly
        // We need to preserve inline formats when removing block formats
        if ((formatName === 'code-block' || formatName === 'blockquote') && value === false && range) {
            const [line, offset] = quill.getLine(range.index);
            if (line) {
                const lineIndex = quill.getIndex(line);
                const lineLength = line.length();

                // Get the Delta for this line to preserve inline formats
                const lineDelta = quill.getContents(lineIndex, lineLength);

                // Collect inline formats from each operation in the line
                const inlineFormats = [];
                let currentIndex = lineIndex;

                for (const op of lineDelta.ops) {
                    if (op.insert && typeof op.insert === 'string' && op.attributes) {
                        // Filter to only inline formats (not block formats)
                        const inlineAttrs = {};
                        const inlineFormatNames = ['bold', 'italic', 'underline', 'strike', 'link', 'code'];
                        for (const key of inlineFormatNames) {
                            if (op.attributes[key] !== undefined) {
                                inlineAttrs[key] = op.attributes[key];
                            }
                        }
                        if (Object.keys(inlineAttrs).length > 0) {
                            inlineFormats.push({
                                index: currentIndex,
                                length: op.insert.length,
                                formats: inlineAttrs
                            });
                        }
                    }
                    if (op.insert) {
                        currentIndex += typeof op.insert === 'string' ? op.insert.length : 1;
                    }
                }

                // Remove all formatting from the line (this removes the block format)
                quill.removeFormat(lineIndex, lineLength, 'api');

                // Re-apply the inline formats we saved
                for (const fmt of inlineFormats) {
                    for (const [key, val] of Object.entries(fmt.formats)) {
                        quill.formatText(fmt.index, fmt.length, key, val, 'api');
                    }
                }
            }
        } else {
            quill.format(formatName, value);
        }

        // Get the updated format state immediately after applying
        const newRange = quill.getSelection();
        return newRange ? quill.getFormat(newRange) : quill.getFormat();
    }
    return {};
}

/**
 * Gets the formatting at the current selection
 * @param {string} editorId - Unique identifier for the editor
 * @returns {Object} Format object
 */
export function getFormat(editorId) {
    const stored = editorStates.get(editorId);
    if (stored) {
        return stored.quill.getFormat();
    }
    return {};
}

/**
 * Enables the editor
 * @param {string} editorId - Unique identifier for the editor
 */
export function enable(editorId) {
    const stored = editorStates.get(editorId);
    if (stored) {
        stored.quill.enable(true);
    }
}

/**
 * Disables the editor
 * @param {string} editorId - Unique identifier for the editor
 */
export function disable(editorId) {
    const stored = editorStates.get(editorId);
    if (stored) {
        stored.quill.enable(false);
    }
}

/**
 * Focuses the editor
 * @param {string} editorId - Unique identifier for the editor
 */
export function focus(editorId) {
    const stored = editorStates.get(editorId);
    if (stored) {
        stored.quill.focus();
    }
}

/**
 * Removes focus from the editor
 * @param {string} editorId - Unique identifier for the editor
 */
export function blur(editorId) {
    const stored = editorStates.get(editorId);
    if (stored) {
        stored.quill.blur();
    }
}
