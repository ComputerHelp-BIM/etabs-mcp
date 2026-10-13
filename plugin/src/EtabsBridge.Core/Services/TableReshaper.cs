using System;
using System.Collections.Generic;

namespace EtabsBridge.Core.Services
{
    /// <summary>Turns the flat, row-major TableData array returned by ETABS into rows.</summary>
    public static class TableReshaper
    {
        /// <param name="data">Flat values: record 0 fields 0..n-1, record 1 fields 0..n-1, ...</param>
        /// <param name="fieldCount">Number of fields per record.</param>
        /// <param name="recordCount">Number of records ETABS reported.</param>
        public static IReadOnlyList<IReadOnlyList<string>> ToRows(string[]? data, int fieldCount, int recordCount)
        {
            if (recordCount <= 0 || fieldCount <= 0)
            {
                return Array.Empty<IReadOnlyList<string>>();
            }

            data ??= Array.Empty<string>();
            long expected = (long)fieldCount * recordCount;
            if (data.Length < expected)
            {
                throw new EtabsApiException(
                    "DatabaseTables.GetTableForDisplayArray",
                    $"returned {data.Length} values for {recordCount} records x {fieldCount} fields");
            }

            var rows = new List<IReadOnlyList<string>>(recordCount);
            for (int r = 0; r < recordCount; r++)
            {
                var row = new string[fieldCount];
                Array.Copy(data, r * fieldCount, row, 0, fieldCount);
                for (int f = 0; f < fieldCount; f++)
                {
                    row[f] ??= string.Empty;
                }

                rows.Add(row);
            }

            return rows;
        }
    }
}
