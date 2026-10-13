using System;
using System.Threading;
using System.Threading.Tasks;

namespace EtabsBridge.Core.Ports
{
    /// <summary>
    /// Runs work on the thread that may call the ETABS API.
    ///
    /// Inside a plugin, ETABS hands us its API object on the UI thread, and the API
    /// is not safe to call from HTTP worker threads. All ETABS access is therefore
    /// funnelled through a dispatcher, which also serializes calls.
    /// </summary>
    public interface IEtabsDispatcher
    {
        /// <summary>
        /// Queues <paramref name="work"/> on the API thread and completes with its result.
        /// If <paramref name="cancellationToken"/> fires before the work starts, the work is
        /// skipped and the task is cancelled. Work that already started cannot be aborted.
        /// </summary>
        Task<T> InvokeAsync<T>(Func<T> work, CancellationToken cancellationToken);
    }

    /// <summary>
    /// Dispatcher for a <see cref="SynchronizationContext"/> (WinForms/WPF UI thread).
    /// Used by the plugin with the ETABS UI thread's WindowsFormsSynchronizationContext.
    /// </summary>
    public sealed class SynchronizationContextDispatcher : IEtabsDispatcher
    {
        private readonly SynchronizationContext _context;

        public SynchronizationContextDispatcher(SynchronizationContext context)
        {
            _context = context ?? throw new ArgumentNullException(nameof(context));
        }

        public Task<T> InvokeAsync<T>(Func<T> work, CancellationToken cancellationToken)
        {
            if (work == null)
            {
                throw new ArgumentNullException(nameof(work));
            }

            var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
            if (cancellationToken.IsCancellationRequested)
            {
                tcs.SetCanceled();
                return tcs.Task;
            }

            // 0 = queued, 1 = started, 2 = cancelled before start.
            int state = 0;
            CancellationTokenRegistration registration = cancellationToken.Register(() =>
            {
                if (Interlocked.CompareExchange(ref state, 2, 0) == 0)
                {
                    tcs.TrySetCanceled();
                }
            });

            _context.Post(
                _ =>
                {
                    if (Interlocked.CompareExchange(ref state, 1, 0) != 0)
                    {
                        return; // cancelled while queued
                    }

                    try
                    {
                        tcs.TrySetResult(work());
                    }
                    catch (Exception ex)
                    {
                        tcs.TrySetException(ex);
                    }
                    finally
                    {
                        registration.Dispose();
                    }
                },
                null);

            return tcs.Task;
        }
    }

    /// <summary>
    /// Runs work inline on the calling thread, one call at a time. For hosts that are not
    /// bound to a UI thread, e.g. DraftWin attached to ETABS out-of-process over COM.
    /// </summary>
    public sealed class SerialDispatcher : IEtabsDispatcher
    {
        private readonly SemaphoreSlim _gate = new SemaphoreSlim(1, 1);

        public async Task<T> InvokeAsync<T>(Func<T> work, CancellationToken cancellationToken)
        {
            if (work == null)
            {
                throw new ArgumentNullException(nameof(work));
            }

            await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                return work();
            }
            finally
            {
                _gate.Release();
            }
        }
    }
}
