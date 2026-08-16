import IntlMessageFormat, {
    type FormatXMLElementFn,
    type PrimitiveType,
} from 'intl-messageformat';

export type MessageFormatValues<T = never> = Record<
    string,
    PrimitiveType | T | FormatXMLElementFn<T>
>;

const formatterCache = new Map<string, IntlMessageFormat>();

const getFormatter = (template: string, locale: string): IntlMessageFormat => {
    const cacheKey = `${locale}\u0000${template}`;
    const cached = formatterCache.get(cacheKey);
    if (cached) return cached;

    const formatter = new IntlMessageFormat(template, locale);
    formatterCache.set(cacheKey, formatter);
    return formatter;
};

export const capitalizeMessageValue = (value: string, locale: string): string =>
    value.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase(locale));

export const formatIcuMessage = <T = never>(
    template: string,
    locale: string,
    values: MessageFormatValues<T>,
): string | T | (string | T)[] =>
    getFormatter(template, locale).format<T>(values);

export interface FormatIcuTextOptions {
    template: string;
    locale: string;
    values: MessageFormatValues;
}

export const formatIcuText = ({
    template,
    locale,
    values,
}: FormatIcuTextOptions): string => {
    const output = formatIcuMessage(template, locale, values);
    return Array.isArray(output) ? output.join('') : output;
};
