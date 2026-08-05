/// <reference types="nativewind/types" />

declare module '*.css' {
  const content: { [className: string]: string };
  export default content;
}
