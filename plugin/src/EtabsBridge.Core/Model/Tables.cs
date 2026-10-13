using System;
using System.Collections.Generic;

namespace EtabsBridge.Core.Model
{
    /// <summary>One entry of the ETABS database tables catalogue (Display &gt; Show Tables).</summary>
    public sealed class TableInfo
    {
        /// <summary>Table key used to fetch the table, e.g. "Frame Assignments - Section Properties".</summary>
        public string Key { get; set; } = string.Empty;

        public string Name { get; set; } = string.Empty;

        /// <summary>
        /// ETABS import type: 0 not importable; 1 importable but not interactively;
        /// 2 interactively importable while the model is unlocked; 3 interactively importable even when locked.
        /// </summary>
        public int ImportType { get; set; }

        /// <summary>True when the table currently has no rows for this model.</summary>
        public bool IsEmpty { get; set; }
    }

    public sealed class TablesResult
    {
        public IReadOnlyList<TableInfo> Tables { get; set; } = Array.Empty<TableInfo>();
    }

    /// <summary>Contents of one database table. All values are strings, exactly as ETABS displays them.</summary>
    public sealed class TableData
    {
        public string Key { get; set; } = string.Empty;

        public int Version { get; set; }

        /// <summary>Group the rows were filtered by ("All" for the whole model).</summary>
        public string Group { get; set; } = "All";

        public IReadOnlyList<string> Fields { get; set; } = Array.Empty<string>();

        /// <summary>Total number of rows in the table, before offset/limit paging.</summary>
        public int TotalRows { get; set; }

        /// <summary>Index of the first returned row within the full table.</summary>
        public int Offset { get; set; }

        /// <summary>Rows (each aligned with <see cref="Fields"/>), possibly a page of the full table.</summary>
        public IReadOnlyList<IReadOnlyList<string>> Rows { get; set; } = Array.Empty<IReadOnlyList<string>>();
    }
}
