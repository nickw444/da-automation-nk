# Digital Alchemy Agent Guide

This project is built using **Digital Alchemy**, a TypeScript framework for Home Automation and NodeJS applications. This guide helps coding agents work effectively using this framework.

## 🏗️ Project Structure

This is a **Digital Alchemy** application with:
- **Core Framework**: Service-based architecture. Each service is a self-contained unit of functionality/automation.
- **Home Assistant Integration**: Via `@digital-alchemy/hass` for entity management and automations
- **TypeScript-first**: Strong typing and modern ESModule support

## 📚 Documentation Resources

**ALWAYS check documentation first** before implementing features:

- **Core docs**: `docs/digital-alchemy/docs/core/` - Framework basics, services, configuration
- **Home Automation docs**: `docs/digital-alchemy/docs/home-automation/` - HASS integration, automations, virtual entities
- **Testing docs**: `docs/digital-alchemy/docs/testing/` - Test patterns and utilities
- **Quickstart guides**: `docs/digital-alchemy/docs/home-automation/quickstart/` - Project templates and setup

## 🔧 Development Commands

### Build & Development
```bash
# Development with hot reload
npm run dev

# Build for production
npm run build

# Run production build
npm run start

# Type checking (always run after changes)
npm run type-check

# Linting
npm run lint

# Format code
npm run format
```

### Testing
```bash
# Run tests
npm run test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

## 🎯 Service Architecture

### Key Patterns
- Services receive `TServiceParams` containing all framework tools
- Return object defines the public API
- Use dependency injection pattern - no manual imports between services
- Access other services via the module structure: `my_app.other_service.method()`. However most services should remain independent from one another, and instead model their own data and logic internally.

## 🏠 Home Assistant Integration

### Entity Access
```typescript
// Entities are strongly typed after running type-writer
hass.entity.light.living_room_lamp.turn_on();
hass.entity.sensor.temperature_outside.state; // with proper typing
```

### Service Calls
```typescript
// Call Home Assistant services
await hass.call.light.turn_on({
  entity_id: "light.living_room",
  brightness: 255
});
```

### Automations
Check `docs/digital-alchemy/docs/home-automation/automation/` for patterns like:
- Solar calculations
- Time-based triggers  
- Area coordination
- Managed switches

## 🧪 Testing Guidelines

- Tests use vi with the framework's testing utilities
- Services can be mocked and tested in isolation
- Use `testRunner.run()` for service testing
- See `docs/digital-alchemy/docs/testing/` for specific patterns

## ⚠️ Important Guidelines

### When Unsure - ASK FIRST
- **Don't invent Digital Alchemy concepts** that may not exist
- **Pause and ask** if you're unsure about framework patterns
- **Check documentation** before assuming how something should work

### Framework Conventions
- Follow **ESModule patterns** with proper imports/exports
- Use **strong typing** - run `type-check` after changes
- **NEVER use `as any`** - find proper TypeScript solutions instead. If you cannot find a solution, ask for help.
- **NEVER use the `any` type** - use proper type annotations. If you cannot find a solution, ask for help.
- Entity IDs should be strongly typed using `keyof HassEntitySetupMapping`. Never use `string`.
- **NEVER use barrel `index.ts` files**: Import directly from the module.
- Always use snake case filenames (e.g. `my_service.ts`)


### Home Assistant Specific
- Use the **type-writer** tool to generate entity types from your HA setup
- Use the **hass proxy objects** and never raw API calls
- Follow **automation patterns** from the docs rather than inventing new ones

## 🔍 Before Making Changes

1. **Search docs/digital-alchemy/docs/** for relevant patterns
2. **Check existing services** for similar functionality  
3. **Run type-check** to ensure TypeScript compliance
4. **Ask for clarification** if framework usage is unclear

## 🚀 Getting Started

For new features:
1. Study similar implementations in docs/digital-alchemy
2. Study similar implementations in src/
3. Follow the service architecture pattern
4. Test with the framework's testing utilities
5. Run type-check and linting before committing

Remember: Digital Alchemy has specific patterns and conventions. When in doubt, consult the documentation or ask for guidance rather than guessing!
