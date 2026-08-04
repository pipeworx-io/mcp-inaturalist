# @pipeworx/inaturalist

iNaturalist citizen-science observations MCP — read-only, no auth.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

- `search_observations(taxon_name?, place?, year?, threatened?, quality_grade?, per_page?)` — observation search with auto-resolved taxon and place names.
- `search_taxa(query, rank?, per_page?)` — find taxa by common or scientific name.
- `top_species(place, year?, per_page?)` — most-observed species at a place.

## Data source

https://api.inaturalist.org/v1/ — public REST API, no key required for read-only.

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "inaturalist": {
      "url": "https://gateway.pipeworx.io/inaturalist/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Inaturalist data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
