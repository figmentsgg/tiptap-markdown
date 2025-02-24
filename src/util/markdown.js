import { marked } from 'marked';

// Create a singleton instance of marked parser
let markedInstance = null;

// Configure and get a marked parser instance
export function getMarkedParser() {
    if (!markedInstance) {
        // Configure marked options
        markedInstance = {
            parse: (text) => marked.parse(text),
            parseInline: (text) => marked.parseInline(text)
        };
    }
    return markedInstance;
}

// Allow cleanup of the instance
export function cleanupMarkedParser() {
    markedInstance = null;
}

/**
 * Implements CommonMark delimiter rules similar to markdown-it
 * See: https://spec.commonmark.org/0.29/#emphasis-and-strong-emphasis
 * 
 * This tries to replicate the behavior of markdown-it's scanDelims function
 * but without dependencies on markdown-it internals
 */
export function canDelimiterBeUsed(text, pos, isOpening) {
    const char = text.charAt(pos);
    
    // Check if we're at the start or end of the text
    const isAtStart = pos === 0;
    const isAtEnd = pos === text.length - 1;
    
    // Get characters before and after (if they exist)
    const prevChar = isAtStart ? ' ' : text.charAt(pos - 1);
    const nextChar = isAtEnd ? ' ' : text.charAt(pos + 1);
    
    // Rule 1: For opening delimiters, left-flanking requires:
    // - not followed by Unicode whitespace
    // - not followed by punctuation, or
    // - preceded by Unicode whitespace or punctuation
    const isUnicodeWhitespace = /\s/.test(nextChar);
    const isPunctuation = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(nextChar);
    const isPrecededByWhitespaceOrPunct = /[\s!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(prevChar);
    
    // Rule 2: For closing delimiters, right-flanking requires:
    // - not preceded by Unicode whitespace
    // - not preceded by punctuation, or
    // - followed by Unicode whitespace or punctuation
    const isPrecededByWhitespace = /\s/.test(prevChar);
    const isPrecededByPunct = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(prevChar);
    const isFollowedByWhitespaceOrPunct = /[\s!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(nextChar);
    
    // Left flanking if not followed by whitespace and either:
    // - not followed by punctuation, or
    // - preceded by whitespace or punctuation
    const isLeftFlanking = !isUnicodeWhitespace && 
                          (!isPunctuation || isPrecededByWhitespaceOrPunct);
    
    // Right flanking if not preceded by whitespace and either:
    // - not preceded by punctuation, or
    // - followed by whitespace or punctuation
    const isRightFlanking = !isPrecededByWhitespace &&
                           (!isPrecededByPunct || isFollowedByWhitespaceOrPunct);
    
    // For opening delimiters we need left-flanking
    // For closing delimiters we need right-flanking
    return isOpening ? isLeftFlanking : isRightFlanking;
}

export function shiftDelim(text, delim, start, offset) {
    let res = text.substring(0, start) + text.substring(start + delim.length);
    res = res.substring(0, start + offset) + delim + res.substring(start + offset);
    return res;
}

function trimStart(text, delim, from, to) {
    let pos = from, res = text;
    while(pos < to) {
        if(canDelimiterBeUsed(res, pos, true)) {
            break;
        }
        res = shiftDelim(res, delim, pos, 1);
        pos++;
    }
    return { text: res, from: pos, to }
}

function trimEnd(text, delim, from, to) {
    let pos = to, res = text;
    while(pos > from) {
        if(canDelimiterBeUsed(res, pos, false)) {
            break;
        }
        res = shiftDelim(res, delim, pos, -1);
        pos--;
    }
    return { text: res, from, to: pos }
}

export function trimInline(text, delim, from, to) {
    let state = {
        text,
        from,
        to,
    }

    state = trimStart(state.text, delim, state.from, state.to);
    state = trimEnd(state.text, delim, state.from, state.to);

    if(state.to - state.from < delim.length + 1) {
        state.text = state.text.substring(0, state.from) + state.text.substring(state.to + delim.length);
    }

    return state.text;
}
