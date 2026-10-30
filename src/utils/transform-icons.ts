import {
  IndentationText,
  type JsxSelfClosingElement,
  Project,
  QuoteKind,
  ScriptKind,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";
import type { RegistryItem } from "@/types.js";

export interface IconLibraryDefinition {
  extraPackages?: string[];
  importStatement: string;
  name: string;
  packageName: string;
  usage: string;
}

export const ICON_LIBRARIES: Record<string, IconLibraryDefinition> = {
  hugeicons: {
    extraPackages: ["@hugeicons/core-free-icons"],
    importStatement:
      'import { HugeiconsIcon } from "@hugeicons/react";\nimport { ICON } from "@hugeicons/core-free-icons";',
    name: "hugeicons",
    packageName: "@hugeicons/react",
    usage: "<HugeiconsIcon icon={ICON} strokeWidth={2} />",
  },
  lucide: {
    importStatement: 'import { ICON } from "lucide-react";',
    name: "lucide",
    packageName: "lucide-react",
    usage: "<ICON />",
  },
  phosphor: {
    importStatement: 'import { ICON } from "@phosphor-icons/react";',
    name: "phosphor",
    packageName: "@phosphor-icons/react",
    usage: "<ICON strokeWidth={2} />",
  },
  radix: {
    importStatement: 'import { ICON } from "@radix-ui/react-icons";',
    name: "radix",
    packageName: "@radix-ui/react-icons",
    usage: "<ICON />",
  },
  remixicon: {
    importStatement: 'import { ICON } from "@remixicon/react";',
    name: "remixicon",
    packageName: "@remixicon/react",
    usage: "<ICON />",
  },
  tabler: {
    importStatement: 'import { ICON } from "@tabler/icons-react";',
    name: "tabler",
    packageName: "@tabler/icons-react",
    usage: "<ICON />",
  },
} as const;

export type SupportedIconLibrary = keyof typeof ICON_LIBRARIES;

const LIBRARY_ALIASES: Record<string, SupportedIconLibrary> = {
  "lucide-react": "lucide",
  "radix-ui": "radix",
};

const TRAILING_SEMICOLONS = /;+$/;
const QUOTES_PATTERN = /^["']|["']$/g;

export function normalizeIconLibrary(
  name?: string
): SupportedIconLibrary | null {
  if (!name) {
    return null;
  }
  const lower = name.toLowerCase().trim();
  if (lower in ICON_LIBRARIES) {
    return lower as SupportedIconLibrary;
  }
  return LIBRARY_ALIASES[lower] ?? null;
}

export function getIconLibraryPackages(libraryName?: string): string[] {
  const normalized = normalizeIconLibrary(libraryName);
  if (!normalized) {
    return [];
  }
  const lib = ICON_LIBRARIES[normalized];
  if (!lib) {
    return [];
  }
  const packages = [lib.packageName];
  if (lib.extraPackages) {
    packages.push(...lib.extraPackages);
  }
  return packages;
}

export function detectIconUsage(items: RegistryItem[]): boolean {
  for (const item of items) {
    for (const file of item.files) {
      if (
        file.content &&
        (file.content.includes("IconPlaceholder") ||
          file.content.includes("lucide-react"))
      ) {
        return true;
      }
    }
  }
  return false;
}

function usesSemicolons(sourceFile: SourceFile): boolean {
  const imports = sourceFile.getImportDeclarations();
  if (imports.length === 0) {
    return true;
  }
  return imports[0]?.getText().trimEnd().endsWith(";") ?? true;
}

function mapIconName(
  name: string,
  targetLibrary: SupportedIconLibrary
): string {
  if (targetLibrary === "radix") {
    return name.endsWith("Icon") ? name : `${name}Icon`;
  }
  if (targetLibrary === "tabler") {
    return name.startsWith("Icon") ? name : `Icon${name}`;
  }
  return name;
}

function cleanAttributeQuotes(raw: string): string {
  return raw.replace(QUOTES_PATTERN, "").trim();
}

function extractTargetIconAttr(
  element: JsxSelfClosingElement,
  targetLibrary: SupportedIconLibrary
) {
  const attributes = element.getAttributes();
  const direct = attributes.find((attr) => {
    if (attr.getKind() !== SyntaxKind.JsxAttribute) {
      return false;
    }
    const nameNode = attr.asKindOrThrow(SyntaxKind.JsxAttribute).getNameNode();
    return nameNode.getText() === targetLibrary;
  });
  if (direct) {
    return direct;
  }
  return attributes.find((attr) => {
    if (attr.getKind() !== SyntaxKind.JsxAttribute) {
      return false;
    }
    const nameNode = attr.asKindOrThrow(SyntaxKind.JsxAttribute).getNameNode();
    return nameNode.getText() === "lucide";
  });
}

function renderReplacedIconElement(
  iconName: string,
  targetLibrary: SupportedIconLibrary,
  userAttributes: string[]
): string {
  if (targetLibrary === "hugeicons") {
    const hasStroke = userAttributes.some((a) => a.startsWith("strokeWidth="));
    const strokeProp = hasStroke ? "" : "strokeWidth={2}";
    const props = [`icon={${iconName}}`, strokeProp, ...userAttributes]
      .filter(Boolean)
      .join(" ");
    return `<HugeiconsIcon ${props} />`;
  }

  if (targetLibrary === "phosphor") {
    const hasStroke = userAttributes.some((a) => a.startsWith("strokeWidth="));
    const strokeProp = hasStroke ? "" : "strokeWidth={2}";
    const props = [strokeProp, ...userAttributes].filter(Boolean).join(" ");
    return props ? `<${iconName} ${props} />` : `<${iconName} />`;
  }

  const props = userAttributes.join(" ");
  return props ? `<${iconName} ${props} />` : `<${iconName} />`;
}

function replacePlaceholderElement(
  element: JsxSelfClosingElement,
  targetLibrary: SupportedIconLibrary,
  transformedIcons: Set<string>
): void {
  const targetIconAttr = extractTargetIconAttr(element, targetLibrary);
  if (!targetIconAttr) {
    return;
  }

  const rawIconName = targetIconAttr
    .asKindOrThrow(SyntaxKind.JsxAttribute)
    .getInitializer()
    ?.getText();
  if (!rawIconName) {
    return;
  }

  const iconName = mapIconName(
    cleanAttributeQuotes(rawIconName),
    targetLibrary
  );
  transformedIcons.add(iconName);

  const userAttributes = element
    .getAttributes()
    .filter((attr) => {
      if (attr.getKind() !== SyntaxKind.JsxAttribute) {
        return true;
      }
      const attrName = attr
        .asKindOrThrow(SyntaxKind.JsxAttribute)
        .getNameNode()
        .getText();
      return !(attrName in ICON_LIBRARIES || attrName in LIBRARY_ALIASES);
    })
    .map((attr) => attr.getText());

  element.replaceWithText(
    renderReplacedIconElement(iconName, targetLibrary, userAttributes)
  );
}

function cleanPlaceholderImports(sourceFile: SourceFile): void {
  for (const importDecl of sourceFile.getImportDeclarations()) {
    const modulePath = importDecl.getModuleSpecifier().getText();
    if (modulePath.includes("icon-placeholder")) {
      const named = importDecl.getNamedImports();
      const placeholderImport = named.find(
        (spec) => spec.getName() === "IconPlaceholder"
      );
      if (placeholderImport) {
        placeholderImport.remove();
      }
      if (importDecl.getNamedImports().length === 0) {
        importDecl.remove();
      }
    }
  }
}

function replaceJsxTagName(
  sourceFile: SourceFile,
  oldName: string,
  newName: string
): void {
  for (const el of sourceFile.getDescendantsOfKind(
    SyntaxKind.JsxSelfClosingElement
  )) {
    if (el.getTagNameNode().getText() === oldName) {
      el.getTagNameNode().replaceWithText(newName);
    }
  }
  for (const el of sourceFile.getDescendantsOfKind(
    SyntaxKind.JsxOpeningElement
  )) {
    if (el.getTagNameNode().getText() === oldName) {
      el.getTagNameNode().replaceWithText(newName);
    }
  }
  for (const el of sourceFile.getDescendantsOfKind(
    SyntaxKind.JsxClosingElement
  )) {
    if (el.getTagNameNode().getText() === oldName) {
      el.getTagNameNode().replaceWithText(newName);
    }
  }
}

function transformLucideImports(
  sourceFile: SourceFile,
  targetLibrary: SupportedIconLibrary,
  transformedIcons: Set<string>
): void {
  for (const importDecl of sourceFile.getImportDeclarations()) {
    const specifier = cleanAttributeQuotes(
      importDecl.getModuleSpecifier().getText()
    );
    if (specifier !== "lucide-react") {
      continue;
    }

    for (const named of importDecl.getNamedImports()) {
      const originalName = named.getName();
      const mappedName = mapIconName(originalName, targetLibrary);
      transformedIcons.add(mappedName);
      replaceJsxTagName(sourceFile, originalName, mappedName);
    }

    importDecl.remove();
  }
}

function injectIconImports(
  sourceFile: SourceFile,
  targetLibrary: SupportedIconLibrary,
  libraryConfig: IconLibraryDefinition,
  transformedIcons: Set<string>
): void {
  const withSemicolons = usesSemicolons(sourceFile);
  const sortedIcons = [...transformedIcons].sort();

  if (targetLibrary === "hugeicons") {
    sourceFile.addImportDeclaration({
      moduleSpecifier: "@hugeicons/react",
      namedImports: [{ name: "HugeiconsIcon" }],
    });
    sourceFile.addImportDeclaration({
      moduleSpecifier: "@hugeicons/core-free-icons",
      namedImports: sortedIcons.map((name) => ({ name })),
    });
  } else {
    sourceFile.addImportDeclaration({
      moduleSpecifier: libraryConfig.packageName,
      namedImports: sortedIcons.map((name) => ({ name })),
    });
  }

  if (!withSemicolons) {
    for (const decl of sourceFile.getImportDeclarations()) {
      const text = decl.getText();
      if (text.endsWith(";")) {
        decl.replaceWithText(text.replace(TRAILING_SEMICOLONS, ""));
      }
    }
  }
}

/**
 * Transforms `<IconPlaceholder ...>` JSX tags and legacy `lucide-react` imports
 * to match the project's configured icon library (e.g. radix, tabler, hugeicons, phosphor).
 */
export function transformIcons(
  content: string,
  targetLibraryName?: string
): string {
  const targetLibrary = normalizeIconLibrary(targetLibraryName) ?? "lucide";
  const hasPlaceholder = content.includes("IconPlaceholder");
  const hasLucide = content.includes("lucide-react");

  if (!hasPlaceholder && (!hasLucide || targetLibrary === "lucide")) {
    return content;
  }

  const libraryConfig = ICON_LIBRARIES[targetLibrary];
  if (!libraryConfig) {
    return content;
  }

  const project = new Project({
    manipulationSettings: {
      indentationText: IndentationText.TwoSpaces,
      quoteKind: QuoteKind.Double,
    },
    useInMemoryFileSystem: true,
  });

  const sourceFile = project.createSourceFile("component.tsx", content, {
    scriptKind: ScriptKind.TSX,
  });

  const transformedIcons = new Set<string>();

  if (hasPlaceholder) {
    const placeholders = sourceFile
      .getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)
      .filter((el) => el.getTagNameNode().getText() === "IconPlaceholder");

    for (const element of placeholders) {
      replacePlaceholderElement(element, targetLibrary, transformedIcons);
    }
    cleanPlaceholderImports(sourceFile);
  }

  if (hasLucide && targetLibrary !== "lucide") {
    transformLucideImports(sourceFile, targetLibrary, transformedIcons);
  }

  if (transformedIcons.size > 0) {
    injectIconImports(
      sourceFile,
      targetLibrary,
      libraryConfig,
      transformedIcons
    );
  }

  return sourceFile.getFullText();
}
