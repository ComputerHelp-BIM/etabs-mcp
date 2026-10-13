using System;
using System.Collections.Generic;
using EtabsBridge.Core.Model;

namespace EtabsBridge.Core.Ports
{
    /// <summary>Basic model facts read straight from the API (the service adds process/bridge info).</summary>
    public sealed class RawModelInfo
    {
        public string FilePath { get; set; } = string.Empty;

        public string EtabsVersion { get; set; } = string.Empty;

        public double EtabsVersionNumber { get; set; }

        public bool IsLocked { get; set; }

        /// <summary>ETABS eUnits name, e.g. "kN_m_C".</summary>
        public string UnitsName { get; set; } = string.Empty;
    }

    /// <summary>Stories exactly as ETABS returns them (order and base entry not normalized).</summary>
    public sealed class RawStories
    {
        public double BaseElevation { get; set; }

        public IReadOnlyList<Story> Stories { get; set; } = Array.Empty<Story>();
    }

    /// <summary>
    /// Port to the ETABS API. The only implementation that talks to ETABS lives in
    /// EtabsBridge.Etabs (EtabsApiModel); tests use fakes.
    ///
    /// Implementations are thin: one method per API call group, translating the API's
    /// parallel arrays into DTOs and throwing <see cref="EtabsApiException"/> on a non-zero
    /// return code. Ordering, validation and cross-object resolution live in
    /// <see cref="Services.GeometryService"/> so they are unit-tested.
    ///
    /// Threading: every member must be called on the thread that owns the ETABS API
    /// object (the ETABS UI thread for a plugin). Use an <see cref="IEtabsDispatcher"/>.
    /// </summary>
    public interface IEtabsModel
    {
        RawModelInfo GetModelInfo();

        RawStories GetStories();

        IReadOnlyList<GridSystem> GetGridSystems();

        /// <summary>All joints with label, story, coordinates (global) and restraints.</summary>
        IReadOnlyList<Joint> GetJoints();

        IReadOnlyList<FrameMember> GetFrames();

        /// <summary>All area objects; <see cref="AreaObject.Points"/> may be left empty (the service resolves them).</summary>
        IReadOnlyList<AreaObject> GetAreas();

        IReadOnlyList<TableInfo> GetTables();

        /// <param name="key">Table key from <see cref="GetTables"/>.</param>
        /// <param name="group">Group name filter; "All" for the whole model.</param>
        /// <param name="fields">Field keys to include; empty for all fields.</param>
        TableData GetTable(string key, string group, IReadOnlyList<string> fields);

        /// <summary>The raw API root (cSapModel) used by the reflective API invoker.</summary>
        object ApiRoot { get; }

        /// <summary>The interface type of <see cref="ApiRoot"/> (typeof(cSapModel)); reflection walks this type.</summary>
        Type ApiRootType { get; }
    }
}
