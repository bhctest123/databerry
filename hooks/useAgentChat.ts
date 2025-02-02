import {
  EventStreamContentType,
  fetchEventSource,
} from '@microsoft/fetch-event-source';

import { ApiError, ApiErrorType } from '@app/utils/api-error';

import useStateReducer from './useStateReducer';

type Props = {
  queryAgentURL: string;
};

const useAgentChat = ({ queryAgentURL }: Props) => {
  const [state, setState] = useStateReducer({
    history: [] as { from: 'human' | 'agent'; message: string }[],
  });

  const handleChatSubmit = async (message: string) => {
    if (!message) {
      return;
    }

    const history = [...state.history, { from: 'human', message }];
    const nextIndex = history.length;

    setState({
      history: history as any,
    });

    let answer = '';
    let error = '';

    try {
      const ctrl = new AbortController();
      let buffer = '';

      class RetriableError extends Error {}
      class FatalError extends Error {}

      await fetchEventSource(queryAgentURL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          streaming: true,
          query: message,
        }),
        signal: ctrl.signal,

        async onopen(response) {
          if (
            response.ok &&
            response.headers.get('content-type') === EventStreamContentType
          ) {
            return; // everything's good
          } else if (
            response.status >= 400 &&
            response.status < 500 &&
            response.status !== 429
          ) {
            if (response.status === 402) {
              throw new ApiError(ApiErrorType.USAGE_LIMIT);
            }
            // client-side errors are usually non-retriable:
            throw new FatalError();
          } else {
            throw new RetriableError();
          }
        },
        onclose() {
          // if the server closes the connection unexpectedly, retry:
          throw new RetriableError();
        },
        onerror(err) {
          console.log('on error', err, Object.keys(err));
          if (err instanceof FatalError) {
            ctrl.abort();
            throw err; // rethrow to stop the operation
          } else if (err instanceof ApiError) {
            console.log('ApiError', ApiError);
            throw err;
          } else {
            // do nothing to automatically retry. You can also
            // return a specific retry interval here.
          }
        },

        onmessage: (event) => {
          if (event.data === '[DONE]') {
            ctrl.abort();
          } else if (event.data?.startsWith('[ERROR]')) {
            ctrl.abort();

            setState({
              history: [
                ...history,
                {
                  from: 'agent',
                  message: event.data.replace('[ERROR]', ''),
                } as any,
              ],
            });
          } else {
            // const data = JSON.parse(event.data || `{}`);
            buffer += decodeURIComponent(event.data) as string;

            const h = [...history];

            if (h?.[nextIndex]) {
              h[nextIndex].message = `${buffer}`;
            } else {
              h.push({ from: 'agent', message: buffer });
            }

            setState({
              history: h as any,
            });
          }
        },
      });
    } catch (err) {
      console.log('err', err);
      if (err instanceof ApiError) {
        if (err?.message) {
          error = err?.message;

          if (error === ApiErrorType.USAGE_LIMIT) {
            answer =
              'Usage limit reached. Please upgrade your plan to get higher usage.';
          } else {
            answer = `Error: ${error}`;
          }
        } else {
          answer = `Error: ${error}`;
        }

        setState({
          history: [
            ...history,
            { from: 'agent', message: answer as string },
          ] as any,
        });
      }
    }
  };

  return {
    handleChatSubmit,
    history: state.history,
  };
};

export default useAgentChat;
