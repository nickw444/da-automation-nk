import { toSnakeCase } from "../snake_case";

describe("toSnakeCase", () => {
  it("should convert a string to snake case", () => {
    expect(toSnakeCase("My Cool Component")).toBe("my_cool_component");
  });

  it("should handle camelCase", () => {
    expect(toSnakeCase("myCoolComponent")).toBe("my_cool_component");
  });

  it("should handle PascalCase", () => {
    expect(toSnakeCase("MyCoolComponent")).toBe("my_cool_component");
  });

  it("should handle single words", () => {
    expect(toSnakeCase("component")).toBe("component");
  });

  it("should handle already snake_case strings", () => {
    expect(toSnakeCase("my_cool_component")).toBe("my_cool_component");
  });

  it("should handle multiple spaces", () => {
    expect(toSnakeCase("My   Cool    Component")).toBe("my_cool_component");
  });

  it("should handle empty string", () => {
    expect(toSnakeCase("")).toBe("");
  });
});