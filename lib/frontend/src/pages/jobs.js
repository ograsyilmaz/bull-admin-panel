const classNames = require('classnames');
const React = require('react');
const PropTypes = require('prop-types');
const progress = require('nprogress');
const {RouterView, Link, getRouter} = require('capybara-router');
const InfiniteScroll = require('react-infinite-scroll');
const FlipMove = require('react-flip-move').default;
const OverlayTrigger = require('react-bootstrap/OverlayTrigger').default;
const Tooltip = require('react-bootstrap/Tooltip').default;
const Base = require('./shared/base');
const Loading = require('../components/loading');
const utils = require('../utils');
const {jobStates, eventTypes} = require('../constants');
const api = require('../api');

module.exports = class Jobs extends Base {
  static get propTypes() {
    return {
      params: PropTypes.shape({
        queue: PropTypes.string,
        state: PropTypes.string
      }).isRequired,
      queues: PropTypes.arrayOf(PropTypes.shape({
        name: PropTypes.string.isRequired
      }).isRequired).isRequired,
      jobs: PropTypes.shape({
        index: PropTypes.number.isRequired,
        total: PropTypes.number.isRequired,
        items: PropTypes.arrayOf(PropTypes.shape({
          id: PropTypes.string.isRequired,
          data: PropTypes.object,
          timestamp: PropTypes.number.isRequired
        }).isRequired).isRequired
      })
    };
  }

  constructor(props) {
    super(props);
    if (!props.jobs) {
      // The Layout component will redirect to the jobs page with a queue name.
      return;
    }

    this.jobIds = new Set(props.jobs.items.map(x => x.id));
    this.state.jobs = props.jobs;
    // Job notifications ----------------------------------
    this.$listens.push(
      api.subscribe(eventTypes.WAITING, ({body}) => {
        this.notificationHandler(eventTypes.WAITING, body.queueName, body.id);
      })
    );
    this.$listens.push(
      api.subscribe(eventTypes.ACTIVE, ({body}) => {
        this.notificationHandler(eventTypes.ACTIVE, body.queueName, body.id);
      })
    );
    this.$listens.push(
      api.subscribe(eventTypes.COMPLETED, ({body}) => {
        this.notificationHandler(eventTypes.COMPLETED, body.queueName, body.id);
      })
    );
    this.$listens.push(
      api.subscribe(eventTypes.FAILED, ({body}) => {
        this.notificationHandler(eventTypes.FAILED, body.queueName, body.id);
      })
    );
    this.$listens.push(
      api.subscribe(eventTypes.PAUSED, ({body}) => {
        this.notificationHandler(eventTypes.PAUSED, body.queueName, body.id);
      })
    );
    this.$listens.push(
      api.subscribe(eventTypes.REMOVED, ({body}) => {
        this.notificationHandler(eventTypes.REMOVED, body.queueName, body.id);
      })
    );
    // ----------------------------------------------------
  }

  componentDidMount() {
    super.componentDidMount();
    const {params, queues} = this.props;

    if (!params.queue) {
      getRouter().go({name: 'web.jobs', params: {queue: queues[0].name}});
    }
  }

  notificationHandler = (eventType, queueName, jobId) => {
    const {params} = this.props;
    if (params.queue !== queueName) {
      // The notification queue isn't equal current queue.
      return;
    }

    /**
     * Remove the job from the state.
     * @param {string} jobId
     * @param {Object} prevState
     * @returns {{jobs: {total: number, items: Array<Job>}}}
     */
    const removeJobFromState = (jobId, prevState) => {
      const jobIndex = prevState.jobs.items.findIndex(x => x.id === jobId);
      const jobs = {
        index: prevState.jobs.index,
        total: prevState.jobs.total,
        items: [...prevState.jobs.items]
      };

      if (jobIndex >= 0) {
        jobs.total -= 1;
        jobs.items.splice(jobIndex, 1);
        this.jobIds.delete(jobId);
        this.loadNextPage(prevState.jobs.index); // Reload the current page.
        return {jobs};
      }
    };

    if (eventType === eventTypes.REMOVED) {
      // The job was removed.
      this.setState(prevState => removeJobFromState(jobId, prevState));
      return;
    }

    api.job.getJob(queueName, jobId, {isBackground: true})
      .then(({body}) => this.setState(prevState => {
        const job = body;

        if (job.state !== (params.state || jobStates.ACTIVE)) {
          // The notification job state isn't equal current state.
          return removeJobFromState(jobId, prevState);
        }

        const jobEventStateMapping = {
          [eventTypes.WAITING]: jobStates.WAITING,
          [eventTypes.ACTIVE]: jobStates.ACTIVE,
          [eventTypes.COMPLETED]: jobStates.COMPLETED,
          [eventTypes.FAILED]: jobStates.FAILED,
          [eventTypes.PAUSED]: jobStates.PAUSED
        };
        if (jobEventStateMapping[eventType] !== job.state) {
          // The job state was changed after the notification.
          return;
        }

        // Insert the job into the current job list.
        const lastJobIndex = prevState.jobs.items.findIndex(x => Number(x.id) < Number(jobId));
        const jobs = {
          index: prevState.jobs.index,
          total: prevState.jobs.total + 1,
          items: [...prevState.jobs.items]
        };

        this.jobIds.add(job.id);
        if (lastJobIndex < 0) {
          jobs.items.unshift(job);
        } else {
          jobs.items.splice(lastJobIndex, 0, job);
        }

        return {jobs};
      }))
      .catch(error => {
        if (error.status === 404) {
          this.setState(prevState => removeJobFromState(jobId, prevState));
        }
      });
  };

  loadNextPage = index => {
    const {params} = this.props;

    return api.job.getJobs(
      params.queue,
      {index, state: params.state || jobStates.ACTIVE}
    )
      .then(({body}) => this.setState(prevState => {
        const jobs = body;
        const items = [...prevState.jobs.items];

        jobs.items.forEach(job => {
          // Make sure the new job isn't exist.
          if (!this.jobIds.has(job.id)) {
            items.push(job);
            this.jobIds.add(job.id);
          }
        });
        return {jobs: {index: jobs.index, items, total: jobs.total}};
      }))
      .catch(utils.renderError);
  };

  generateClickRemoveJobLinkHandler = jobId => event => {
    const {params} = this.props;

    event.preventDefault();
    progress.start();
    api.job.deleteJob(params.queue, jobId)
      .catch(utils.renderError)
      .finally(progress.done);
  };

  onClickCleanJobsButton = event => {
    const {params} = this.props;

    event.preventDefault();
    progress.start();
    api.job.cleanJobs(params.queue, params.state || eventTypes.ACTIVE)
      .then(getRouter().reload)
      .catch(error => {
        progress.done();
        utils.renderError(error);
      });
  };

  infiniteScrollLoadingRender() {
    return <div key={0}><Loading/></div>;
  }

  render() {
    const {params} = this.props;
    const {$isApiProcessing, jobs} = this.state;

    if (!jobs) {
      // The Layout component will redirect to the jobs page with a queue name.
      return <Loading/>;
    }

    const currentState = params.state || jobStates.ACTIVE;
    const isDisableCleanButton = $isApiProcessing || jobs.items.length === 0 ||
      [jobStates.COMPLETED, jobStates.FAILED].indexOf(currentState) < 0;
    const isShowRemoveButton = currentState !== jobStates.ACTIVE;

    return (
      <>
        <div className="tab-content" style={{minHeight: '60vh'}}>
          <div className="text-right mb-2">
            <button
              disabled={isDisableCleanButton}
              className="btn btn-outline-secondary" type="button"
              onClick={this.onClickCleanJobsButton}
            >
              Clean all jobs
            </button>
          </div>

          <InfiniteScroll
            pageStart={0}
            loadMore={this.loadNextPage}
            hasMore={jobs.items.length < jobs.total}
            loader={this.infiniteScrollLoadingRender()}
          >
            <FlipMove
              typeName="div" className="list-group"
              enterAnimation="fade" leaveAnimation="fade"
            >
              {
                jobs.items.map(job => (
                  <div key={job.id} className="list-group-item">
                    <div className="d-flex justify-content-between align-items-center">
                      <div className="text-truncate">
                        <h5 className="mb-1 text-truncate">
                          <Link to={{name: 'web.jobs.details', params: {...params, jobId: job.id}}}>
                            #{job.id}
                          </Link>
                          <small className="ml-2 text-muted text-truncate">
                            {JSON.stringify(job.data).substr(0, 512)}
                          </small>
                        </h5>
                        <small className="text-muted">{utils.formatDate(job.timestamp)}</small>
                      </div>
                      {
                        isShowRemoveButton && (
                          <div>
                            <OverlayTrigger overlay={<Tooltip>Remove</Tooltip>}>
                              <a
                                href="#delete"
                                className={classNames('btn btn-link text-danger', {disabled: $isApiProcessing})}
                                onClick={this.generateClickRemoveJobLinkHandler(job.id)}
                              >
                                <i className="far fa-trash-alt"/>
                              </a>
                            </OverlayTrigger>
                          </div>
                        )
                      }
                    </div>
                  </div>
                ))
              }
            </FlipMove>
          </InfiniteScroll>
          {
            jobs.items.length === 0 && (
              <p className="text-center text-muted py-5 h4">Empty</p>
            )
          }
        </div>
        <RouterView/>
      </>
    );
  }
};
