import { marked } from 'marked';

// Use a symbol for private properties
const parserSymbol = Symbol('markedParser');

// Cleanup global function
let globalCleanupScheduled = false;

/**
 * Get the marked parser singleton - lazily initialized
 */
export function getMarkedParser() {
    // Only create if needed and return wrapped functions, not the instance
    if (!globalThis[parserSymbol]) {
        const wrapAndClean = (fn) => {
            return (...args) => {
                try {
                    return fn(...args);
                } finally {
                    // Schedule cleanup after processing is done
                    if (!globalCleanupScheduled) {
                        globalCleanupScheduled = true;
                        setTimeout(() => {
                            // Clear parser if no active usage
                            if (globalThis[parserSymbol] && !document.querySelector('.ProseMirror')) {
                                cleanupMarkedParser();
                            }
                            globalCleanupScheduled = false;
                        }, 5000);
                    }
                }
            };
        };

        globalThis[parserSymbol] = {
            parse: wrapAndClean(marked.parse),
            parseInline: wrapAndClean(marked.parseInline)
        };
    }
    return globalThis[parserSymbol];
}

/**
 * Clean up the marked parser
 */
export function cleanupMarkedParser() {
    if (globalThis[parserSymbol]) {
        globalThis[parserSymbol] = null;
    }
}

/**
 * Optimized delimiter check
 * This combines the can_open and can_close checks from CommonMark spec
 * 
 * @param {string} text - The text to check
 * @param {number} pos - Position of the delimiter
 * @param {boolean} isOpening - Whether it's an opening or closing delimiter
 * @returns {boolean} Whether the delimiter can be used
 */
export function canDelimiterBeUsed(text, pos, isOpening) {
    if (!text || pos < 0 || pos >= text.length) return false;
    
    const char = text.charAt(pos);
    
    // Fast checks for edge cases
    if (pos === 0) return isOpening;
    if (pos === text.length - 1) return !isOpening;
    
    // Get the surrounding characters using charCodeAt for performance
    const prevCharCode = text.charCodeAt(pos - 1);
    const nextCharCode = text.charCodeAt(pos + 1);
    
    // Whitespace check using character codes (faster than regex)
    const isPrevWhitespace = prevCharCode <= 32; // space or control char
    const isNextWhitespace = nextCharCode <= 32;
    
    // Punctuation check using character ranges (faster than regex)
    const isPrevPunctuation = isPunctuation(prevCharCode);
    const isNextPunctuation = isPunctuation(nextCharCode);
    
    // Efficient implementation of CommonMark rules
    if (isOpening) {
        // For opening, we need left-flanking
        return !isNextWhitespace && (!isNextPunctuation || isPrevWhitespace || isPrevPunctuation);
    } else {
        // For closing, we need right-flanking
        return !isPrevWhitespace && (!isPrevPunctuation || isNextWhitespace || isNextPunctuation);
    }
}

/**
 * Fast punctuation check
 * @param {number} charCode 
 * @returns {boolean}
 */
function isPunctuation(charCode) {
    // Check if character is punctuation using character codes
    return (charCode >= 33 && charCode <= 47) ||   // ! " # $ % & ' ( ) * + , - . /
           (charCode >= 58 && charCode <= 64) ||   // : ; < = > ? @
           (charCode >= 91 && charCode <= 96) ||   // [ \ ] ^ _ `
           (charCode >= 123 && charCode <= 126);   // { | } ~
}

/**
 * Optimized delim shifting
 * @param {string} text
 * @param {string} delim
 * @param {number} start
 * @param {number} offset
 * @returns {string}
 */
export function shiftDelim(text, delim, start, offset) {
    // Use substring operations for better performance
    // This avoids creating too many intermediate strings
    return text.substring(0, start) + 
           text.substring(start + delim.length, start + offset) + 
           delim + 
           text.substring(start + offset);
}

/**
 * Optimized trim start function
 */
function trimStart(text, delim, from, to) {
    if (from >= to) return { text, from, to };
    
    let pos = from, res = text;
    // Limit iterations to prevent potential infinite loops
    const maxIterations = to - from;
    let iterations = 0;
    
    while (pos < to && iterations < maxIterations) {
        if (canDelimiterBeUsed(res, pos, true)) {
            break;
        }
        res = shiftDelim(res, delim, pos, 1);
        pos++;
        iterations++;
    }
    
    return { text: res, from: pos, to };
}

/**
 * Optimized trim end function
 */
function trimEnd(text, delim, from, to) {
    if (from >= to) return { text, from, to };
    
    let pos = to, res = text;
    // Limit iterations to prevent potential infinite loops
    const maxIterations = to - from;
    let iterations = 0;
    
    while (pos > from && iterations < maxIterations) {
        if (canDelimiterBeUsed(res, pos, false)) {
            break;
        }
        res = shiftDelim(res, delim, pos, -1);
        pos--;
        iterations++;
    }
    
    return { text: res, from, to: pos };
}

/**
 * Optimized string manipulation for inline markdown
 * @param {string} text - Input text
 * @param {string} delim - Delimiter
 * @param {number} from - Start position
 * @param {number} to - End position
 * @returns {string}
 */
export function trimInline(text, delim, from, to) {
    if (!text || from < 0 || to >= text.length || from >= to) {
        return text;
    }
    
    try {
        let state = { text, from, to };
        
        // Apply trimming operations
        state = trimStart(state.text, delim, state.from, state.to);
        state = trimEnd(state.text, delim, state.from, state.to);
        
        // Check if we need to remove the inline markup entirely
        if (state.to - state.from < delim.length + 1) {
            state.text = state.text.substring(0, state.from) + 
                         state.text.substring(state.to + delim.length);
        }
        
        return state.text;
    } catch (e) {
        console.error('Error in trimInline:', e);
        return text;
    }
}
